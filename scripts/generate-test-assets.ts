/**
 * Test Asset Generation Script
 *
 * Generates the following test assets for M0.5 probe:
 *   - demo-project/assets/background.png
 *   - demo-project/assets/character_normal.png
 *   - demo-project/assets/character_angry.png
 *   - demo-project/assets/character_mouth.png
 *   - demo-project/assets/dialogue.mp3
 *
 * Usage:
 *   cd panda-stage && npx tsx scripts/generate-test-assets.ts
 *
 * Note: This script uses Node.js child_process to spawn Python
 * (since PIL is the most reliable cross-platform image generator).
 * If Python is not available, you may need to install Pillow first:
 *   pip install Pillow
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ASSETS_DIR = path.resolve(__dirname, '../demo-project/assets');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateWithPython(): void {
  const pythonScript = `
from PIL import Image, ImageDraw, ImageFont
import os
import math

assets_dir = r"${ASSETS_DIR.replace(/\\/g, '\\\\')}"

# 1. background.png
bg = Image.new('RGB', (1920, 1080), color=(30, 100, 200))
draw = ImageDraw.Draw(bg)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", 120)
except:
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 120)
    except:
        font = ImageFont.load_default()
text = "背景"
bbox = draw.textbbox((0, 0), text, font=font)
text_w = bbox[2] - bbox[0]
text_h = bbox[3] - bbox[1]
draw.text(((1920 - text_w) / 2, (1080 - text_h) / 2), text, fill=(255, 255, 255), font=font)
for i in range(0, 1920, 120):
    draw.line([(i, 0), (i, 1080)], fill=(50, 120, 220), width=1)
for i in range(0, 1080, 120):
    draw.line([(0, i), (1920, i)], fill=(50, 120, 220), width=1)
bg.save(os.path.join(assets_dir, "background.png"), "PNG")

# 2. character_normal.png
char = Image.new('RGBA', (400, 600), (0, 0, 0, 0))
draw_c = ImageDraw.Draw(char)
draw_c.ellipse([(50, 50), (350, 350)], fill=(255, 200, 150, 255), outline=(200, 150, 100, 255), width=4)
draw_c.ellipse([(120, 130), (170, 180)], fill=(255, 255, 255, 255), outline=(100, 100, 100, 255), width=2)
draw_c.ellipse([(230, 130), (280, 180)], fill=(255, 255, 255, 255), outline=(100, 100, 100, 255), width=2)
draw_c.ellipse([(140, 145), (160, 165)], fill=(50, 50, 150, 255))
draw_c.ellipse([(250, 145), (270, 165)], fill=(50, 50, 150, 255))
draw_c.arc([(140, 200), (280, 280)], start=0, end=180, fill=(150, 50, 50, 255), width=4)
draw_c.rounded_rectangle([(100, 340), (300, 550)], radius=30, fill=(80, 120, 200, 255), outline=(50, 80, 150, 255), width=4)
try:
    label_font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 32)
except:
    label_font = ImageFont.load_default()
draw_c.text((130, 420), "NORMAL", fill=(255, 255, 255, 255), font=label_font)
char.save(os.path.join(assets_dir, "character_normal.png"), "PNG")

# 3. character_angry.png
char_a = Image.new('RGBA', (400, 600), (0, 0, 0, 0))
draw_a = ImageDraw.Draw(char_a)
draw_a.ellipse([(50, 50), (350, 350)], fill=(255, 180, 140, 255), outline=(200, 130, 80, 255), width=4)
draw_a.line([(110, 120), (170, 150)], fill=(100, 0, 0, 255), width=6)
draw_a.line([(290, 120), (230, 150)], fill=(100, 0, 0, 255), width=6)
draw_a.ellipse([(130, 160), (170, 200)], fill=(255, 255, 255, 255), outline=(100, 100, 100, 255), width=2)
draw_a.ellipse([(230, 160), (270, 200)], fill=(255, 255, 255, 255), outline=(100, 100, 100, 255), width=2)
draw_a.ellipse([(145, 175), (165, 195)], fill=(50, 50, 150, 255))
draw_a.ellipse([(245, 175), (265, 195)], fill=(50, 50, 150, 255))
draw_a.arc([(160, 240), (260, 300)], start=180, end=360, fill=(150, 30, 30, 255), width=6)
draw_a.rounded_rectangle([(100, 340), (300, 550)], radius=30, fill=(180, 60, 60, 255), outline=(130, 40, 40, 255), width=4)
draw_a.text((140, 420), "ANGRY", fill=(255, 255, 255, 255), font=label_font)
char_a.save(os.path.join(assets_dir, "character_angry.png"), "PNG")

# 4. character_mouth.png
char_m = Image.new('RGBA', (400, 600), (0, 0, 0, 0))
draw_m = ImageDraw.Draw(char_m)
draw_m.ellipse([(50, 50), (350, 350)], fill=(255, 200, 150, 255), outline=(200, 150, 100, 255), width=4)
draw_m.ellipse([(120, 120), (180, 180)], fill=(255, 255, 255, 255), outline=(100, 100, 100, 255), width=2)
draw_m.ellipse([(220, 120), (280, 180)], fill=(255, 255, 255, 255), outline=(100, 100, 100, 255), width=2)
draw_m.ellipse([(140, 140), (170, 170)], fill=(50, 50, 150, 255))
draw_m.ellipse([(240, 140), (270, 170)], fill=(50, 50, 150, 255))
draw_m.ellipse([(160, 220), (260, 300)], fill=(80, 20, 20, 255), outline=(150, 50, 50, 255), width=3)
draw_m.rounded_rectangle([(100, 340), (300, 550)], radius=30, fill=(80, 120, 200, 255), outline=(50, 80, 150, 255), width=4)
draw_m.text((135, 420), "MOUTH", fill=(255, 255, 255, 255), font=label_font)
char_m.save(os.path.join(assets_dir, "character_mouth.png"), "PNG")

# 5. dialogue.mp3 - Construct valid MPEG-1 Layer III frames
frame_header = bytes([0xFF, 0xFB, 0x90, 0x00])
side_info = bytes(32)
main_data = bytes(381)
frame = frame_header + side_info + main_data
num_frames = 192
mp3_data = b'ID3\x04\x00\x00\x00\x00\x00\x00' + frame * num_frames
mp3_path = os.path.join(assets_dir, "dialogue.mp3")
with open(mp3_path, 'wb') as f:
    f.write(mp3_data)

print("Assets generated successfully.")
for fname in ["background.png", "character_normal.png", "character_angry.png", "character_mouth.png", "dialogue.mp3"]:
    fpath = os.path.join(assets_dir, fname)
    print(f"  {fname}: {os.path.getsize(fpath)} bytes")
`;

  const scriptPath = path.join(ASSETS_DIR, 'generate.py');
  fs.writeFileSync(scriptPath, pythonScript);

  try {
    execSync(`python "${scriptPath}"`, { stdio: 'inherit' });
    fs.unlinkSync(scriptPath);
  } catch (err) {
    console.error('Failed to run Python script. Make sure Python and Pillow are installed.');
    console.error(err);
    process.exit(1);
  }
}

function main(): void {
  ensureDir(ASSETS_DIR);
  console.log('Generating test assets...');
  generateWithPython();
  console.log('Done.');
}

main();
