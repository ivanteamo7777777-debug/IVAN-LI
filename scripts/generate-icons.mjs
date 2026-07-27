import sharp from "sharp";

const source = "public/icons/app-mark.svg";
const targets = [
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
  ["public/icons/icon-maskable-512.png", 512],
  ["public/icons/apple-touch-icon.png", 180],
  ["public/icons/badge-96.png", 96],
];

for (const [path, size] of targets) {
  await sharp(source).resize(size, size).png({ compressionLevel: 9 }).toFile(path);
}
