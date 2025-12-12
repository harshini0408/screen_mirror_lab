# Application Icons

Place your application icons in this folder:

- **icon.ico** - Windows icon (256x256 pixels, .ico format)
- **icon.png** - Linux icon (512x512 pixels, .png format)  
- **icon.icns** - macOS icon (512x512 pixels, .icns format)

## Creating Icons

### From PNG to ICO (Windows)
1. Create a 256x256 PNG image
2. Use online converter: https://convertio.co/png-ico/
3. Save as `icon.ico`

### From PNG to ICNS (macOS)
1. Create a 512x512 PNG image
2. Use online converter: https://cloudconvert.com/png-to-icns
3. Save as `icon.icns`

### Recommended Icon Design
- Simple, clear design
- High contrast
- Represents the application purpose
- Works well at small sizes (16x16, 32x32)

## Default Behavior
If icons are missing, electron-builder will use default Electron icons.
