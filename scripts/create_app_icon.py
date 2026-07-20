from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
BRAND_DIR = ROOT / "apps" / "mobile" / "assets" / "brand"
SOURCE = BRAND_DIR / "pinme-logo-final.png"
ICON = BRAND_DIR / "pinme-app-icon-1024.png"
PREVIEW = BRAND_DIR / "pinme-app-icon-rounded-preview.png"
RED_WHITE_ICON = BRAND_DIR / "pinme-app-icon-red-white.png"
RED_WHITE_ACCENT_ICON = BRAND_DIR / "pinme-app-icon-red-white-purple-accent.png"
RED_WHITE_PREVIEW = BRAND_DIR / "pinme-app-icon-red-white-preview.png"

ICON_SIZE = 1024
TARGET_ART_HEIGHT = 840  # 82% of the icon canvas.
THEME_RED = (230, 76, 97)  # apps/mobile/design/system.tsx colors.primary


def colored_mask(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    saturation = rgb.max(axis=2) - rgb.min(axis=2)
    return (rgb.min(axis=2) < 248) & (saturation > 8)


def mask_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    if not len(xs):
        raise ValueError("No colored logo artwork was detected")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def make_icon(source: Image.Image) -> Image.Image:
    box = mask_bbox(colored_mask(source))
    art_height = box[3] - box[1]
    scale = TARGET_ART_HEIGHT / art_height

    # Keep a few source pixels around the artwork so antialiased edges are not clipped.
    padding = 8
    crop_box = (
        max(0, box[0] - padding),
        max(0, box[1] - padding),
        min(source.width, box[2] + padding),
        min(source.height, box[3] + padding),
    )
    crop = source.convert("RGB").crop(crop_box)
    resized = crop.resize(
        (round(crop.width * scale), round(crop.height * scale)),
        Image.Resampling.LANCZOS,
    )

    # Center the detected artwork itself, rather than the old oversized canvas.
    relative_center_x = ((box[0] + box[2]) / 2 - crop_box[0]) * scale
    relative_center_y = ((box[1] + box[3]) / 2 - crop_box[1]) * scale
    paste_x = round(ICON_SIZE / 2 - relative_center_x)
    paste_y = round(ICON_SIZE / 2 - relative_center_y)

    icon = Image.new("RGB", (ICON_SIZE, ICON_SIZE), "white")
    icon.paste(resized, (paste_x, paste_y))
    return icon


def make_rounded_preview(icon: Image.Image) -> Image.Image:
    canvas_size = 1200
    display_size = 760
    radius = 168
    offset = (canvas_size - display_size) // 2

    preview = Image.new("RGB", (canvas_size, canvas_size), "#f2f3f6")
    shadow = Image.new("RGBA", preview.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (offset, offset + 18, offset + display_size, offset + display_size + 18),
        radius=radius,
        fill=(26, 27, 35, 58),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    preview.paste(shadow, (0, 0), shadow)

    scaled = icon.resize((display_size, display_size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (display_size, display_size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, display_size - 1, display_size - 1),
        radius=radius,
        fill=255,
    )
    preview.paste(scaled, (offset, offset), mask)
    return preview


def foreground_alpha(icon: Image.Image) -> Image.Image:
    rgb = np.asarray(icon.convert("RGB"), dtype=np.int16)
    distance_from_white = 255 - rgb.min(axis=2)
    alpha = np.clip((distance_from_white - 2) / 42 * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(alpha, "L")


def make_red_white(icon: Image.Image, keep_purple_accent: bool = False) -> Image.Image:
    alpha = foreground_alpha(icon)
    result = Image.new("RGB", icon.size, THEME_RED)
    white_art = Image.new("RGB", icon.size, "white")
    result.paste(white_art, (0, 0), alpha)

    if keep_purple_accent:
        rgb = np.asarray(icon.convert("RGB"), dtype=np.int16)
        purple = (rgb[:, :, 2] > rgb[:, :, 0] + 12) & (rgb[:, :, 2] > rgb[:, :, 1] + 30)
        purple_alpha = np.where(purple, np.asarray(alpha), 0).astype(np.uint8)
        result.paste(icon, (0, 0), Image.fromarray(purple_alpha, "L"))
    return result


def make_variant_preview(plain: Image.Image, accent: Image.Image) -> Image.Image:
    width, height = 1480, 820
    tile_size = 600
    radius = 132
    preview = Image.new("RGB", (width, height), "#f2f3f6")
    for index, icon in enumerate((plain, accent)):
        x = 90 + index * 700
        y = 90
        shadow = Image.new("RGBA", preview.size, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            (x, y + 16, x + tile_size, y + tile_size + 16),
            radius=radius,
            fill=(26, 27, 35, 58),
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(24))
        preview.paste(shadow, (0, 0), shadow)

        scaled = icon.resize((tile_size, tile_size), Image.Resampling.LANCZOS)
        mask = Image.new("L", (tile_size, tile_size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, tile_size - 1, tile_size - 1), radius=radius, fill=255
        )
        preview.paste(scaled, (x, y), mask)
    return preview


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    icon = make_icon(source)
    icon.save(ICON, optimize=True)
    make_rounded_preview(icon).save(PREVIEW, optimize=True)

    red_white = make_red_white(icon)
    red_white_accent = make_red_white(icon, keep_purple_accent=True)
    red_white.save(RED_WHITE_ICON, optimize=True)
    red_white_accent.save(RED_WHITE_ACCENT_ICON, optimize=True)
    make_variant_preview(red_white, red_white_accent).save(RED_WHITE_PREVIEW, optimize=True)

    output_box = mask_bbox(colored_mask(icon))
    width = output_box[2] - output_box[0]
    height = output_box[3] - output_box[1]
    if icon.size != (ICON_SIZE, ICON_SIZE) or icon.mode != "RGB":
        raise ValueError("App icon format validation failed")
    if not 0.81 <= height / ICON_SIZE <= 0.83:
        raise ValueError("Artwork scale validation failed")

    print(f"ICON={ICON}")
    print(f"PREVIEW={PREVIEW}")
    print(f"RED_WHITE_ICON={RED_WHITE_ICON}")
    print(f"RED_WHITE_ACCENT_ICON={RED_WHITE_ACCENT_ICON}")
    print(f"RED_WHITE_PREVIEW={RED_WHITE_PREVIEW}")
    print(f"ART_BBOX={output_box}")
    print(f"ART_OCCUPANCY={width / ICON_SIZE:.1%} x {height / ICON_SIZE:.1%}")


if __name__ == "__main__":
    main()
