// This plugin extracts all text from Figma Slides deck

interface TextItem {
  text: string;
  markdown: string; // Markdown formatted text (e.g., "# Title", "## Heading", etc.)
  level: 'title' | 'heading' | 'subheading' | 'body';
}

interface ContentRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'text' | 'image';
  confidence: number;
}

interface ColumnLayout {
  columnCount: number;
  columns: Array<{
    x: number;
    width: number;
    contentDensity: number;
  }>;
  whitespaceRegions: Array<{
    x: number;
    width: number;
  }>;
}

interface SlideAnalysis {
  regions: ContentRegion[];
  layout: ColumnLayout;
}

interface SlideData {
  sectionNumber: number;
  slideNumber: number;
  overallSlideNumber: number;
  textContent: string[]; // Plain text (for backward compatibility)
  formattedContent: TextItem[]; // Text with markdown formatting
  analysis?: SlideAnalysis; // Optional visual analysis results
}

// Recursively find all text nodes in a node tree, ignoring hidden and locked nodes
// Optimized to avoid creating intermediate arrays
function findAllTextNodes(node: SceneNode, result: TextNode[] = []): TextNode[] {
  // Skip hidden nodes
  if (node.visible === false) {
    return result;
  }
  
  // Skip locked nodes
  if (node.locked === true) {
    return result;
  }
  
  if (node.type === 'TEXT') {
    // Add text node (we've already filtered out hidden and locked nodes above)
    result.push(node);
  }
  
  if ('children' in node) {
    for (const child of node.children) {
      findAllTextNodes(child, result);
    }
  }
  
  return result;
}

// Placeholder for future column detection - currently assumes 2 columns
const NUM_COLUMNS = 2;

// Export slide as PNG image, downsampled for performance
async function exportSlideImage(slide: SceneNode): Promise<{ imageData: Uint8Array; width: number; height: number } | null> {
  try {
    // Get slide dimensions
    const slideWidth = 'width' in slide ? slide.width : 1920;
    const slideHeight = 'height' in slide ? slide.height : 1080;
    
    // Calculate scale factor to downsample to ~400px width
    const targetWidth = 400;
    const scale = Math.min(1, targetWidth / slideWidth);
    
    // Export slide as PNG (exportAsync is a method on SceneNode)
    const imageData = await (slide as any).exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: scale }
    });
    
    // Calculate actual dimensions after scaling
    const scaledWidth = Math.round(slideWidth * scale);
    const scaledHeight = Math.round(slideHeight * scale);
    
    return {
      imageData: imageData,
      width: scaledWidth,
      height: scaledHeight
    };
  } catch (error) {
    console.error('Error exporting slide image:', error);
    return null;
  }
}

// Determine which column a text node belongs to based on its X position
// Column 1: 0% to 40% of slide width
// Column 2: 40% to 100% of slide width
function getColumnForTextNode(textNode: TextNode, slideWidth: number): number {
  const COLUMN_1_BOUNDARY = slideWidth * 0.4; // 40% of width
  
  // Use the top-left corner (x position) to determine column
  if (textNode.x < COLUMN_1_BOUNDARY) {
    return 1;
  } else {
    return 2;
  }
}

// Calculate absolute position of a node relative to the slide
function getAbsolutePosition(node: SceneNode, slide: SceneNode): { x: number; y: number } {
  let x = node.x;
  let y = node.y;
  let current: SceneNode | null = node.parent as SceneNode;
  
  // Traverse up the parent chain to get absolute position
  while (current && current !== slide && current !== null) {
    x += current.x;
    y += current.y;
    current = current.parent as SceneNode;
  }
  
  return { x, y };
}

// Sort text nodes by columns: Column 1 (top to bottom), then Column 2 (top to bottom), etc.
function sortTextNodesByColumns(nodes: TextNode[], slide: SceneNode, slideWidth: number, analysis: SlideAnalysis | null = null): TextNode[] {
  // Create array with nodes and their absolute positions
  const nodesWithPositions = nodes.map(node => {
    const absPos = getAbsolutePosition(node, slide);
    return { node, x: absPos.x, y: absPos.y };
  });
  
  // Determine column boundaries from analysis or use default
  let columnBoundaries: number[] = [];
  
  if (analysis && analysis.layout && analysis.layout.columns.length > 0) {
    // Use column boundaries from analysis
    // Analysis was done on downsampled image (~400px width)
    const targetAnalysisWidth = 400;
    const analysisScale = Math.min(1, targetAnalysisWidth / slideWidth);
    const analysisWidth = Math.round(slideWidth * analysisScale);
    
    // Calculate boundaries as the start of each column, scaled from analysis to slide space
    columnBoundaries = [0];
    for (const col of analysis.layout.columns) {
      // Scale from analysis space (analysisWidth) to slide space (slideWidth)
      const slideX = (col.x / analysisWidth) * slideWidth;
      columnBoundaries.push(slideX);
    }
    // Add end boundary
    columnBoundaries.push(slideWidth);
    // Sort boundaries to ensure correct order
    columnBoundaries.sort((a, b) => a - b);
  } else {
    // Fallback to 2-column assumption (40% boundary)
    columnBoundaries = [0, slideWidth * 0.4, slideWidth];
  }
  
  // Separate nodes into columns based on their absolute X position
  const columns: Array<typeof nodesWithPositions> = [];
  for (let i = 0; i < columnBoundaries.length - 1; i++) {
    columns.push([]);
  }
  
  for (const item of nodesWithPositions) {
    // Find which column this node belongs to
    for (let i = 0; i < columnBoundaries.length - 1; i++) {
      if (item.x >= columnBoundaries[i] && item.x < columnBoundaries[i + 1]) {
        columns[i].push(item);
        break;
      }
    }
  }
  
  // Sort each column by Y position (top to bottom)
  for (const column of columns) {
    column.sort((a, b) => a.y - b.y);
  }
  
  // IMPORTANT: Return ALL of column 1 first, then ALL of column 2, etc.
  // This ensures all text in each column appears in order
  const result: TextNode[] = [];
  
  // Add all columns in order
  for (const column of columns) {
    for (const item of column) {
      result.push(item.node);
    }
  }
  
  return result;
}

// Get font size from a text node
// In Figma, font size is accessed via getRangeFontSize() method
function getFontSize(textNode: TextNode): number {
  try {
    // Use getRangeFontSize to get the font size at the start of the text
    // This handles text nodes with mixed font sizes by getting the first character's size
    if (textNode.characters.length > 0) {
      const fontSize = textNode.getRangeFontSize(0, 1) as number;
      if (typeof fontSize === 'number' && fontSize > 0) {
        return fontSize;
      }
    }
  } catch (e) {
    console.warn('Could not get font size from text node:', e);
  }
  
  // Default fallback if we can't determine font size
  return 16;
}

// Categorize text nodes by font size into 4 markdown levels
// Uses clustering to group similar font sizes and assign them to levels
function categorizeFontSizes(textNodes: TextNode[]): {
  title: number;
  heading: number;
  subheading: number;
  body: number;
} {
  if (textNodes.length === 0) {
    // Default thresholds if no nodes
    return { title: 32, heading: 24, subheading: 18, body: 14 };
  }
  
  // Get all font sizes
  const fontSizes = textNodes.map(node => getFontSize(node));
  
  // Sort font sizes in descending order
  const sortedSizes = [...fontSizes].sort((a, b) => b - a);
  
  if (sortedSizes.length === 0) {
    return { title: 32, heading: 24, subheading: 18, body: 14 };
  }
  
  const maxSize = sortedSizes[0];
  const minSize = sortedSizes[sortedSizes.length - 1];
  const sizeRange = maxSize - minSize;
  
  // If all sizes are very similar, use default thresholds
  if (sizeRange < 2) {
    return { title: maxSize, heading: maxSize * 0.75, subheading: maxSize * 0.6, body: maxSize * 0.5 };
  }
  
  // Use percentiles to determine thresholds
  // Top 25% = Title, next 25% = Heading, next 25% = Subheading, bottom 25% = Body
  const p75 = sortedSizes[Math.floor(sortedSizes.length * 0.25)]; // 75th percentile (top 25%)
  const p50 = sortedSizes[Math.floor(sortedSizes.length * 0.5)];   // 50th percentile (top 50%)
  const p25 = sortedSizes[Math.floor(sortedSizes.length * 0.75)];  // 25th percentile (top 75%)
  
  // Cluster similar sizes together
  // Find distinct size groups by looking for gaps in the sorted sizes
  const uniqueSizes = Array.from(new Set(sortedSizes)).sort((a, b) => b - a);
  
  // If we have 4 or more distinct sizes, use the top 4
  if (uniqueSizes.length >= 4) {
    return {
      title: uniqueSizes[0],
      heading: uniqueSizes[1],
      subheading: uniqueSizes[2],
      body: uniqueSizes[3]
    };
  }
  
  // If we have 3 distinct sizes
  if (uniqueSizes.length === 3) {
    return {
      title: uniqueSizes[0],
      heading: uniqueSizes[1],
      subheading: uniqueSizes[2],
      body: uniqueSizes[2] * 0.8
    };
  }
  
  // If we have 2 distinct sizes
  if (uniqueSizes.length === 2) {
    return {
      title: uniqueSizes[0],
      heading: uniqueSizes[1],
      subheading: uniqueSizes[1] * 0.85,
      body: uniqueSizes[1] * 0.7
    };
  }
  
  // If we have 1 distinct size, use percentiles
  return {
    title: p75,
    heading: p50,
    subheading: p25,
    body: minSize
  };
}

// Determine markdown level for a font size
// Uses thresholds to categorize: Title (largest), Heading, Subheading, Body (smallest)
function getMarkdownLevel(fontSize: number, thresholds: ReturnType<typeof categorizeFontSizes>): 'title' | 'heading' | 'subheading' | 'body' {
  // Calculate midpoints between thresholds for better categorization
  const titleMidpoint = (thresholds.title + thresholds.heading) / 2;
  const headingMidpoint = (thresholds.heading + thresholds.subheading) / 2;
  const subheadingMidpoint = (thresholds.subheading + thresholds.body) / 2;
  
  // Assign level based on which threshold range the font size falls into
  if (fontSize >= titleMidpoint) {
    return 'title';
  } else if (fontSize >= headingMidpoint) {
    return 'heading';
  } else if (fontSize >= subheadingMidpoint) {
    return 'subheading';
  } else {
    return 'body';
  }
}

// Format text with markdown based on level
function formatMarkdown(text: string, level: 'title' | 'heading' | 'subheading' | 'body'): string {
  switch (level) {
    case 'title':
      return `# ${text}`;
    case 'heading':
      return `## ${text}`;
    case 'subheading':
      return `### ${text}`;
    case 'body':
      return text;
  }
}

// Check if a point falls within any image region
function isPointInImageRegion(x: number, y: number, imageRegions: ContentRegion[], slideWidth: number, slideHeight: number, analysisWidth: number, analysisHeight: number): boolean {
  // Scale coordinates from slide space to analysis space
  // Analysis was done on downsampled image (analysisWidth x analysisHeight)
  // Regions are in analysis space, so we need to scale slide coordinates to analysis space
  const scaleX = analysisWidth / slideWidth;
  const scaleY = analysisHeight / slideHeight;
  const scaledX = x * scaleX;
  const scaledY = y * scaleY;
  
  for (const region of imageRegions) {
    if (region.type === 'image' &&
        scaledX >= region.x &&
        scaledX <= region.x + region.width &&
        scaledY >= region.y &&
        scaledY <= region.y + region.height) {
      return true;
    }
  }
  return false;
}

// Extract text content from a slide with markdown formatting
function extractSlideText(slide: SceneNode, analysis: SlideAnalysis | null = null): { plainText: string[]; formattedText: TextItem[] } {
  let textNodes = findAllTextNodes(slide);
  
  // Get slide width to determine column boundaries
  // The slide node should have width/height properties (FrameNode, etc.)
  const slideWidth = 'width' in slide ? slide.width : 1920; // Default to 1920 if width not available
  const slideHeight = 'height' in slide ? slide.height : 1080; // Default to 1080 if height not available
  
  // Filter out text nodes that fall within image regions
  if (analysis && analysis.regions) {
    const imageRegions = analysis.regions.filter(r => r.type === 'image');
    if (imageRegions.length > 0) {
      // Analysis was done on downsampled image (~400px width)
      // Calculate the actual analysis dimensions
      const targetAnalysisWidth = 400;
      const analysisScale = Math.min(1, targetAnalysisWidth / slideWidth);
      const analysisWidth = Math.round(slideWidth * analysisScale);
      const analysisHeight = Math.round(slideHeight * analysisScale);
      
      textNodes = textNodes.filter(node => {
        const absPos = getAbsolutePosition(node, slide);
        // Check center point of text node
        const centerX = absPos.x + (node.width || 0) / 2;
        const centerY = absPos.y + (node.height || 0) / 2;
        
        // Check if center point is in an image region
        return !isPointInImageRegion(centerX, centerY, imageRegions, slideWidth, slideHeight, analysisWidth, analysisHeight);
      });
    }
  }
  
  // Sort nodes by columns: Column 1 (top to bottom), then Column 2 (top to bottom)
  const sortedNodes = sortTextNodesByColumns(textNodes, slide, slideWidth, analysis);
  
  // Categorize font sizes to determine thresholds
  const thresholds = categorizeFontSizes(sortedNodes);
  
  // Create formatted text items
  const formattedItems: TextItem[] = [];
  const plainText: string[] = [];
  
  for (const node of sortedNodes) {
    const text = node.characters;
    const fontSize = getFontSize(node);
    const level = getMarkdownLevel(fontSize, thresholds);
    const markdown = formatMarkdown(text, level);
    
    formattedItems.push({
      text: text,
      markdown: markdown,
      level: level
    });
    
    plainText.push(text);
  }
  
  // Debug logging (can be removed in production)
  if (textNodes.length > 0) {
    const filteredCount = textNodes.length - sortedNodes.length;
    if (filteredCount > 0) {
      console.log(`Filtered out ${filteredCount} text nodes in image regions`);
    }
    if (analysis && analysis.layout) {
      console.log(`Detected ${analysis.layout.columnCount} columns from visual analysis`);
    }
    console.log(`Font size thresholds: Title>=${thresholds.title.toFixed(1)}, Heading>=${thresholds.heading.toFixed(1)}, Subheading>=${thresholds.subheading.toFixed(1)}, Body<${thresholds.subheading.toFixed(1)}`);
  }
  
  return { plainText, formattedText: formattedItems };
}

// Request analysis for a slide and wait for result (with timeout)
async function requestSlideAnalysis(slide: SceneNode, slideId: string): Promise<SlideAnalysis | null> {
  // Check cache first
  if (analysisCache.has(slideId)) {
    return analysisCache.get(slideId)!;
  }
  
  // Export slide image
  const exportResult = await exportSlideImage(slide);
  if (!exportResult) {
    console.warn(`Failed to export image for slide ${slideId}`);
    return null;
  }
  
  // Send analysis request to UI
  // Note: Uint8Array needs to be converted to regular array for message passing
  const imageDataArray = new Array(exportResult.imageData.length);
  for (let i = 0; i < exportResult.imageData.length; i++) {
    imageDataArray[i] = exportResult.imageData[i];
  }
  
  figma.ui.postMessage({
    type: 'analyze-slide-image',
    imageData: imageDataArray,
    width: exportResult.width,
    height: exportResult.height,
    slideId: slideId
  });
  
  // Wait for analysis result with timeout
  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn(`Analysis timeout for slide ${slideId}, using defaults`);
        resolve(null);
      }
    }, 200); // 200ms timeout
    
    const checkCache = () => {
      if (resolved) return;
      
      if (analysisCache.has(slideId)) {
        resolved = true;
        clearTimeout(timeout);
        resolve(analysisCache.get(slideId)!);
      } else {
        setTimeout(checkCache, 10); // Check every 10ms
      }
    };
    
    checkCache();
  });
}

// Process slides in batches to avoid freezing the UI
function processSlidesInBatches(
  slideItems: Array<{ node: SceneNode; sectionNumber: number; slideNumber: number }>,
  onProgress: (current: number, total: number) => void,
  onComplete: (slidesData: SlideData[]) => void
) {
  const slidesData: SlideData[] = [];
  const BATCH_SIZE = 5; // Process 5 slides at a time
  let currentIndex = 0;
  
  async function processBatch() {
    const endIndex = Math.min(currentIndex + BATCH_SIZE, slideItems.length);
    
    // Process a batch of slides
    for (let i = currentIndex; i < endIndex; i++) {
      const item = slideItems[i];
      if (item && item.node) {
        try {
          // Generate slide ID for caching
          const slideId = `slide-${item.sectionNumber}-${item.slideNumber}`;
          
          // Request visual analysis before extracting text
          const analysis = await requestSlideAnalysis(item.node, slideId);
          
          // Extract text with analysis results
          const { plainText, formattedText } = extractSlideText(item.node, analysis);
          
          slidesData.push({
            sectionNumber: item.sectionNumber,
            slideNumber: item.slideNumber,
            overallSlideNumber: 0, // Will be set after sorting
            textContent: plainText,
            formattedContent: formattedText,
            analysis: analysis || undefined
          });
        } catch (error) {
          console.error(`Error processing slide ${item.sectionNumber}-${item.slideNumber}:`, error);
        }
      }
    }
    
    currentIndex = endIndex;
    onProgress(currentIndex, slideItems.length);
    
    // If there are more slides, schedule next batch
    if (currentIndex < slideItems.length) {
      setTimeout(processBatch, 0); // Yield to UI thread
    } else {
      // All slides processed, now sort and finalize
      slidesData.sort((a, b) => {
        if (a.sectionNumber !== b.sectionNumber) {
          return a.sectionNumber - b.sectionNumber;
        }
        return a.slideNumber - b.slideNumber;
      });
      
      // Add overall slide numbers
      slidesData.forEach((slide, index) => {
        slide.overallSlideNumber = index + 1;
      });
      
      onComplete(slidesData);
    }
  }
  
  // Start processing
  if (slideItems.length > 0) {
    processBatch();
  } else {
    onComplete([]);
  }
}

// Collect slide items from grid in batches to avoid blocking
function collectSlideItemsFromGrid(
  slideGrid: any[][],
  onProgress: (current: number, total: number, message: string) => void,
  onComplete: (slideItems: Array<{ node: SceneNode; sectionNumber: number; slideNumber: number }>) => void
) {
  const slideItems: Array<{ node: SceneNode; sectionNumber: number; slideNumber: number }> = [];
  
  // First, count total slides
  let totalSlides = 0;
  for (let sectionIndex = 0; sectionIndex < slideGrid.length; sectionIndex++) {
    const section = slideGrid[sectionIndex];
    if (section && Array.isArray(section)) {
      totalSlides += section.length;
    }
  }
  
  if (totalSlides === 0) {
    onComplete([]);
    return;
  }
  
  onProgress(0, totalSlides, `Scanning ${totalSlides} slides...`);
  
  let sectionIndex = 0;
  let slideIndex = 0;
  let collectedCount = 0;
  
  function collectBatch() {
    const BATCH_SIZE = 50; // Collect 50 slide references at a time
    let collectedInBatch = 0;
    
    while (sectionIndex < slideGrid.length && collectedInBatch < BATCH_SIZE) {
      const section = slideGrid[sectionIndex];
      if (section && Array.isArray(section)) {
        while (slideIndex < section.length && collectedInBatch < BATCH_SIZE) {
          const slideNode = section[slideIndex];
          if (slideNode) {
            const node = slideNode.node || slideNode;
            
            // Skip hidden slides
            if (node && node.visible !== false) {
              const sectionNumber = slideNode.sectionNumber !== undefined 
                ? slideNode.sectionNumber 
                : (slideNode.section !== undefined ? slideNode.section : sectionIndex + 1);
              const slideNumber = slideNode.slideNumber !== undefined 
                ? slideNode.slideNumber 
                : (slideNode.number !== undefined ? slideNode.number : slideIndex + 1);
              
              slideItems.push({ node, sectionNumber, slideNumber });
              collectedCount++;
              collectedInBatch++;
            }
          }
          slideIndex++;
        }
        
        if (slideIndex >= section.length) {
          sectionIndex++;
          slideIndex = 0;
        }
      } else {
        sectionIndex++;
        slideIndex = 0;
      }
    }
    
    onProgress(collectedCount, totalSlides, `Scanning slide ${collectedCount} of ${totalSlides}...`);
    
    if (collectedCount < totalSlides) {
      setTimeout(collectBatch, 0); // Yield to UI
    } else {
      onComplete(slideItems);
    }
  }
  
  collectBatch();
}

// Main function to extract all slide data using Figma Slides API
function extractAllSlidesData(
  onProgress: (current: number, total: number, message: string) => void,
  onComplete: (slidesData: SlideData[]) => void
) {
  try {
    // Use Figma Slides API: getSlideGrid() returns a 2D array of SlideNode objects
    // Each SlideNode has sectionNumber and slideNumber properties
    if (typeof (figma as any).getSlideGrid === 'function') {
      onProgress(0, 0, 'Accessing slide grid...');
      
      // Wrap getSlideGrid in setTimeout to yield, in case it's blocking
      setTimeout(() => {
        try {
      const slideGrid = (figma as any).getSlideGrid() as any[][];
      
      console.log('Slide grid retrieved:', slideGrid);
      
      if (!slideGrid || slideGrid.length === 0) {
        console.log('Slide grid is empty or undefined');
        // Try fallback approach
            return extractSlidesFallback(onProgress, onComplete);
          }
          
          // Collect slide items in batches to avoid blocking
          collectSlideItemsFromGrid(slideGrid, onProgress, (slideItems) => {
            if (slideItems.length === 0) {
              return extractSlidesFallback(onProgress, onComplete);
            }
            
            onProgress(0, slideItems.length, `Found ${slideItems.length} slides. Processing...`);
            
            // Process slides in batches
            processSlidesInBatches(slideItems, (current, total) => {
              onProgress(current, total, `Processing slide ${current} of ${total}...`);
            }, onComplete);
          });
        } catch (e) {
          console.error('Error accessing slide grid:', e);
          extractSlidesFallback(onProgress, onComplete);
        }
      }, 0);
      
    } else {
      console.log('getSlideGrid is not available, using fallback');
      // Fallback: if getSlideGrid is not available, try to find slides manually
      return extractSlidesFallback(onProgress, onComplete);
    }
  } catch (e) {
    console.error('Error accessing Figma Slides API:', e);
    // Try fallback on error
    return extractSlidesFallback(onProgress, onComplete);
  }
}

// Fallback function to extract slides from frames
function extractSlidesFallback(
  onProgress: (current: number, total: number, message: string) => void,
  onComplete: (slidesData: SlideData[]) => void
) {
  onProgress(0, 0, 'Scanning for frames...');
  
  // Use setTimeout to yield before the potentially expensive findAll operation
  setTimeout(() => {
    try {
  // Get all frames on the current page
  const allFrames = figma.currentPage.findAll(node => node.type === 'FRAME') as FrameNode[];
  console.log(`Found ${allFrames.length} frames on the page`);
  
      if (allFrames.length === 0) {
        onComplete([]);
        return;
      }
      
      onProgress(0, allFrames.length, `Found ${allFrames.length} frames. Analyzing...`);
      
      // Collect slide items from frames in batches
      const slideItems: Array<{ node: SceneNode; sectionNumber: number; slideNumber: number }> = [];
      let frameIndex = 0;
      const BATCH_SIZE = 100; // Process 100 frames at a time
      
      function analyzeBatch() {
        const endIndex = Math.min(frameIndex + BATCH_SIZE, allFrames.length);
        
        for (let i = frameIndex; i < endIndex; i++) {
          const frame = allFrames[i];
          
          // Skip hidden slides
          if (frame.visible === false) {
            continue;
          }
          
    const name = frame.name;
    let sectionNumber: number | null = null;
    let slideNumber: number | null = null;
    
    // Pattern 1: "Section X - Slide Y" or "Section X, Slide Y"
    const pattern1 = name.match(/[Ss]ection\s*(\d+)[\s,\-]+[Ss]lide\s*(\d+)/i);
    if (pattern1) {
      sectionNumber = parseInt(pattern1[1], 10);
      slideNumber = parseInt(pattern1[2], 10);
    } else {
      // Pattern 2: "S1-S2" or "S1.S2"
      const pattern2 = name.match(/[Ss](\d+)[\s,\-\.]+[Ss]?(\d+)/i);
      if (pattern2) {
        sectionNumber = parseInt(pattern2[1], 10);
        slideNumber = parseInt(pattern2[2], 10);
      } else {
        // Pattern 3: "1.2" (section.slide)
        const pattern3 = name.match(/(\d+)\.(\d+)/);
        if (pattern3) {
          sectionNumber = parseInt(pattern3[1], 10);
          slideNumber = parseInt(pattern3[2], 10);
        } else {
          // Pattern 4: Just "Slide X" (assume section 1)
          const slideOnly = name.match(/[Ss]lide\s*(\d+)/i);
          if (slideOnly) {
            sectionNumber = 1;
            slideNumber = parseInt(slideOnly[1], 10);
          }
        }
      }
    }
    
          // If we found section and slide numbers, add to items
    if (sectionNumber !== null && slideNumber !== null) {
            slideItems.push({
              node: frame,
        sectionNumber: sectionNumber,
              slideNumber: slideNumber
            });
          }
        }
        
        frameIndex = endIndex;
        onProgress(frameIndex, allFrames.length, `Analyzing frame ${frameIndex} of ${allFrames.length}...`);
        
        if (frameIndex < allFrames.length) {
          setTimeout(analyzeBatch, 0); // Yield to UI
        } else {
          if (slideItems.length === 0) {
            onComplete([]);
            return;
          }
          
          onProgress(0, slideItems.length, `Found ${slideItems.length} slides. Processing...`);
          
          // Process slides in batches
          processSlidesInBatches(slideItems, (current, total) => {
            onProgress(current, total, `Processing slide ${current} of ${total}...`);
          }, onComplete);
        }
      }
      
      analyzeBatch();
    } catch (error) {
      console.error('Error in fallback extraction:', error);
      onComplete([]);
    }
  }, 0);
}

// Function to extract and send slides data
async function extractAndSendSlides() {
  try {
    // Check if we're in a Figma Slides file
    const isSlidesFile = typeof (figma as any).getSlideGrid === 'function';
    
    // Show initial progress immediately
    console.log('Starting extraction...');
    figma.ui.postMessage({
      type: 'progress',
      current: 0,
      total: 0,
      message: 'Starting extraction...'
    });
    
    // Delay slightly to ensure UI is ready
    setTimeout(() => {
      console.log('Beginning extraction process...');
      extractAllSlidesData(
        (current, total, message) => {
          // Send progress updates
          console.log(`Progress: ${current}/${total} - ${message}`);
          figma.ui.postMessage({
            type: 'progress',
            current: current,
            total: total,
            message: message
          });
        },
        async (slidesData) => {
          // Extraction complete
    if (slidesData.length === 0) {
      let errorMessage = 'No slides found. ';
      if (!isSlidesFile) {
        errorMessage += 'This does not appear to be a Figma Slides file. ';
      }
      errorMessage += 'Make sure you have a Figma Slides deck open with at least one slide. ';
      errorMessage += 'If your slides are named with patterns like "Section 1 - Slide 2", they should be detected.';
      
      figma.ui.postMessage({
        type: 'error',
        message: errorMessage
      });
    } else {
      // Load saved system prompt and send it with the data
      const savedPrompt = await figma.clientStorage.getAsync('customSystemPrompt');
      
      figma.ui.postMessage({
        type: 'data',
        data: slidesData,
        systemPrompt: savedPrompt || null
      });
    }
        }
      );
    }, 100); // Small delay to ensure UI is ready
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: `Error extracting text: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}

// Show UI
figma.showUI(__html__, { width: 300, height: 600, themeColors: true });

// Analysis result cache
const analysisCache = new Map<string, SlideAnalysis>();

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'update-context') {
    // Re-extract slides when update context is requested
    await extractAndSendSlides();
  } else if (msg.type === 'slide-analysis-result') {
    // Store analysis result in cache
    const slideId = (msg as any).slideId;
    const analysis = (msg as any).analysis;
    if (slideId && analysis) {
      analysisCache.set(slideId, analysis);
    }
  } else if (msg.type === 'save-system-prompt') {
    // Save system prompt to clientStorage
    try {
      await figma.clientStorage.setAsync('customSystemPrompt', msg.prompt);
      figma.ui.postMessage({
        type: 'system-prompt-saved',
        success: true
      });
    } catch (error) {
      figma.ui.postMessage({
        type: 'system-prompt-saved',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  } else if (msg.type === 'load-system-prompt') {
    // Load and send system prompt
    try {
      const savedPrompt = await figma.clientStorage.getAsync('customSystemPrompt');
      figma.ui.postMessage({
        type: 'system-prompt-loaded',
        prompt: savedPrompt || null
      });
    } catch (error) {
      figma.ui.postMessage({
        type: 'system-prompt-loaded',
        prompt: null
      });
    }
  }
};

// Initial extraction and load system prompt
(async () => {
  await extractAndSendSlides();
  // Also send system prompt on initial load
  try {
    const savedPrompt = await figma.clientStorage.getAsync('customSystemPrompt');
    figma.ui.postMessage({
      type: 'system-prompt-loaded',
      prompt: savedPrompt || null
    });
  } catch (error) {
    // Ignore error, will use default
  }
})();


