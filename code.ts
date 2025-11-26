// This plugin extracts all text from Figma Slides deck

interface SlideData {
  sectionNumber: number;
  slideNumber: number;
  overallSlideNumber: number;
  textContent: string[];
}

// Recursively find all text nodes in a node tree, ignoring hidden nodes
// Optimized to avoid creating intermediate arrays
function findAllTextNodes(node: SceneNode, result: TextNode[] = []): TextNode[] {
  // Skip hidden nodes
  if (node.visible === false) {
    return result;
  }
  
  if (node.type === 'TEXT') {
    result.push(node);
  }
  
  if ('children' in node) {
    for (const child of node.children) {
      findAllTextNodes(child, result);
    }
  }
  
  return result;
}

// Sort text nodes by position: top to bottom, then left to right
function sortTextNodesByPosition(nodes: TextNode[]): TextNode[] {
  return nodes.sort((a, b) => {
    // First sort by Y position (top to bottom)
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > 5) { // Allow 5px tolerance for "same row"
      return yDiff;
    }
    // If roughly same Y, sort by X (left to right)
    return a.x - b.x;
  });
}

// Extract text content from a slide
function extractSlideText(slide: SceneNode): string[] {
  const textNodes = findAllTextNodes(slide);
  const sortedNodes = sortTextNodesByPosition(textNodes);
  return sortedNodes.map(node => node.characters);
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
  
  function processBatch() {
    const endIndex = Math.min(currentIndex + BATCH_SIZE, slideItems.length);
    
    // Process a batch of slides
    for (let i = currentIndex; i < endIndex; i++) {
      const item = slideItems[i];
      if (item && item.node) {
        try {
          const textContent = extractSlideText(item.node);
          slidesData.push({
            sectionNumber: item.sectionNumber,
            slideNumber: item.slideNumber,
            overallSlideNumber: 0, // Will be set after sorting
            textContent: textContent
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
            
            if (node) {
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

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'update-context') {
    // Re-extract slides when update context is requested
    await extractAndSendSlides();
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


