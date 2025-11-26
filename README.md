# Figma Slides Text Extractor

A Figma plugin that extracts all text content from a Figma Slides deck and displays it as JSON in a UI panel.

## Features

- Extracts all text nodes from each slide in a Figma Slides deck
- Organizes text by section number and slide number
- Sorts text nodes left-to-right, top-to-bottom based on position
- Displays JSON output in a user-friendly UI panel
- Copy to clipboard functionality

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the plugin:
   ```bash
   npm run build
   ```

3. In Figma Desktop:
   - Go to `Plugins` > `Development` > `Import plugin from manifest...`
   - Select the `manifest.json` file from this directory

## Usage

1. Open a Figma Slides deck in Figma
2. Run the plugin from `Plugins` > `Development` > `Figma Slides Text Extractor`
3. The plugin will extract all text from all slides
4. View the JSON output in the plugin panel
5. Click "Copy to Clipboard" to copy the JSON

## JSON Output Format

The plugin outputs a flat array of objects, each representing a slide:

```json
[
  {
    "sectionNumber": 1,
    "slideNumber": 1,
    "textContent": [
      "Title text",
      "Subtitle text",
      "Body text line 1",
      "Body text line 2"
    ]
  },
  {
    "sectionNumber": 1,
    "slideNumber": 2,
    "textContent": [
      "Slide 2 Title",
      "Slide 2 Content"
    ]
  }
]
```

## Development

- `code.ts` - Main plugin logic
- `ui.html` - UI panel interface
- `manifest.json` - Plugin configuration

### Build Commands

- `npm run build` - Build the plugin once
- `npm run watch` - Build and watch for changes

## Requirements

- Figma Desktop app
- Node.js and npm
- A Figma Slides deck file

