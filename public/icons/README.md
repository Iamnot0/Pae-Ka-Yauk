# Icons

Placeholder brand mark (`icon.svg`) is a warm-brown square with a gold "P" monogram.

## To generate PNG variants from `icon.svg`

Requires ImageMagick (`apt install imagemagick`) or Inkscape.

```bash
# PWA standard sizes
magick icon.svg -resize 192x192 icon-192.png
magick icon.svg -resize 512x512 icon-512.png
magick icon.svg -resize 512x512 icon-maskable-512.png   # add 20% padding for adaptive

# iOS apple-touch-icon sizes
magick icon.svg -resize 180x180 apple-touch-icon-180.png
magick icon.svg -resize 167x167 apple-touch-icon-167.png
magick icon.svg -resize 152x152 apple-touch-icon-152.png
magick icon.svg -resize 120x120 apple-touch-icon-120.png

# Favicon
magick icon.svg -resize 32x32 favicon-32.png
magick icon.svg -resize 32x32 favicon.ico
```

Swap `icon.svg` for the final Pae Ka Yauk brand mark once the client provides it.
