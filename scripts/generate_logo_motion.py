from __future__ import annotations

import json
import math
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PIN = Path(r"C:\Users\23590\AppData\Local\Temp\codex-clipboard-d35a19ef-c51f-44b1-9c72-17cbb24028ef.png")
SOURCE_EFFECT = Path(r"C:\Users\23590\AppData\Local\Temp\codex-clipboard-aea4fe45-0981-4da0-be92-d6aadb95d79b.png")
OUT_DIR = ROOT / "apps" / "mobile" / "assets" / "brand"
FPS = 30
FRAME_COUNT = 54
GIF_SIZE = (512, 512)


def colored_mask(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    saturation = rgb.max(axis=2) - rgb.min(axis=2)
    return (rgb.min(axis=2) < 248) & (saturation > 8)


def components(mask: np.ndarray, min_size: int = 24) -> list[np.ndarray]:
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    found: list[np.ndarray] = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or seen[y, x]:
                continue
            queue = deque([(x, y)])
            seen[y, x] = True
            pixels: list[tuple[int, int]] = []
            while queue:
                px, py = queue.popleft()
                pixels.append((px, py))
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((nx, ny))
            if len(pixels) >= min_size:
                component = np.zeros_like(mask, dtype=bool)
                xs, ys = zip(*pixels)
                component[np.asarray(ys), np.asarray(xs)] = True
                found.append(component)
    return sorted(found, key=lambda item: int(item.sum()), reverse=True)


def bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def rgba_component(source: Image.Image, mask: np.ndarray) -> Image.Image:
    rgba = source.convert("RGBA")
    alpha = np.where(mask, np.asarray(rgba)[:, :, 3], 0).astype(np.uint8)
    result = rgba.copy()
    result.putalpha(Image.fromarray(alpha, "L"))
    return result


def crop_layer(layer: Image.Image) -> tuple[Image.Image, tuple[int, int]]:
    alpha = np.asarray(layer.getchannel("A"))
    ys, xs = np.where(alpha > 0)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return layer.crop(box), (box[0], box[1])


def paste_center(canvas: Image.Image, sprite: Image.Image, center: tuple[float, float], opacity: float = 1.0) -> None:
    sprite = sprite.copy()
    if opacity < 0.999:
        alpha = np.asarray(sprite.getchannel("A"), dtype=np.float32)
        sprite.putalpha(Image.fromarray(np.clip(alpha * opacity, 0, 255).astype(np.uint8), "L"))
    x = round(center[0] - sprite.width / 2)
    y = round(center[1] - sprite.height / 2)
    canvas.alpha_composite(sprite, (x, y))


def ease_out_cubic(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return 1.0 - (1.0 - value) ** 3


def ease_in_out(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def scale_sprite(sprite: Image.Image, scale: float) -> Image.Image:
    if scale <= 0.01:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    size = (max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale)))
    return sprite.resize(size, Image.Resampling.LANCZOS)


def transform_sprite(sprite: Image.Image, scale: float = 1.0, angle: float = 0.0) -> Image.Image:
    transformed = scale_sprite(sprite, scale)
    if abs(angle) > 0.01:
        transformed = transformed.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    return transformed


def extract_layers() -> dict:
    pin_source = Image.open(SOURCE_PIN).convert("RGBA")
    effect_source = Image.open(SOURCE_EFFECT).convert("RGBA")
    if pin_source.size != effect_source.size:
        raise ValueError("Source images must use the same canvas size")

    pin_components = components(colored_mask(pin_source))
    effect_components = components(colored_mask(effect_source))
    if not pin_components or len(effect_components) < 7:
        raise ValueError("Could not identify the expected logo components")

    source_pin_mask = pin_components[0]
    pin_layer = rgba_component(pin_source, source_pin_mask)
    pin_crop, _ = crop_layer(pin_layer)

    # Rotate the exact Image 1 pin to the approved Image 2 angle.
    final_pin = pin_crop.rotate(21.5, resample=Image.Resampling.BICUBIC, expand=True)
    pin_alpha = np.asarray(final_pin.getchannel("A"))
    ys, xs = np.where(pin_alpha > 12)
    tip_y = int(ys.max())
    tip_x = int(np.median(xs[ys >= tip_y - 2]))

    # In Image 2 the largest component is the old pin. Every other component is
    # part of the approved impact effect or one of the three hearts.
    retained_masks = effect_components[1:]
    retained = []
    for component in retained_masks:
        layer = rgba_component(effect_source, component)
        layer_crop, origin = crop_layer(layer)
        x0, y0, x1, y1 = bbox(component)
        retained.append(
            {
                "mask": component,
                "layer": layer,
                "crop": layer_crop,
                "origin": origin,
                "bbox": (x0, y0, x1, y1),
                "center": ((x0 + x1) / 2, (y0 + y1) / 2),
                "area": int(component.sum()),
            }
        )

    # Hearts are compact filled components above the impact point. The impact
    # arc is the widest low component; the remaining two are motion strokes.
    hearts = [item for item in retained if (item["bbox"][2] - item["bbox"][0]) < 90 and item["center"][1] < 900]
    hearts = sorted(hearts, key=lambda item: item["center"][1], reverse=True)[:3]
    heart_ids = {id(item) for item in hearts}
    effects = [item for item in retained if id(item) not in heart_ids]
    arc = max(effects, key=lambda item: item["bbox"][2] - item["bbox"][0])
    strokes = [item for item in effects if item is not arc]

    target = ((arc["bbox"][0] + arc["bbox"][2]) / 2, arc["bbox"][1] + 4)
    pin_center = (target[0] - tip_x + final_pin.width / 2, target[1] - tip_y + final_pin.height / 2)

    return {
        "canvas_size": pin_source.size,
        "pin": final_pin,
        "pin_center": pin_center,
        "target": target,
        "arc": arc,
        "strokes": strokes,
        "hearts": hearts,
    }


def animation_state(frame: int, heart_index: int | None = None) -> dict:
    # 0-14: strike; 15-28: hearts pop; 29-43: hold; 44-53: reset.
    if frame <= 14:
        p = ease_out_cubic(frame / 14)
        pin_shift = (-34 * (1 - p), -42 * (1 - p))
        pin_angle = 5.5 * (1 - p)
    elif frame <= 43:
        pin_shift = (0.0, 0.0)
        pin_angle = 0.0
    else:
        p = ease_in_out((frame - 43) / 10)
        pin_shift = (-34 * p, -42 * p)
        pin_angle = 5.5 * p

    impact_in = ease_out_cubic((frame - 10) / 6)
    impact_out = 1.0 - ease_in_out((frame - 43) / 10)
    impact_opacity = max(0.0, min(impact_in, impact_out))
    impact_scale = 0.72 + 0.34 * impact_in

    heart_scale = 0.0
    heart_opacity = 0.0
    heart_progress = 0.0
    if heart_index is not None:
        start = 13 + heart_index * 3
        heart_progress = ease_out_cubic((frame - start) / 8)
        heart_scale = min(1.12, 1.25 * heart_progress)
        if heart_progress > 0.82:
            heart_scale = 1.12 - (heart_progress - 0.82) / 0.18 * 0.12
        heart_opacity = min(1.0, heart_progress * 1.7)
        if frame > 43:
            heart_opacity *= 1.0 - ease_in_out((frame - 43) / 10)

    return {
        "pin_shift": pin_shift,
        "pin_angle": pin_angle,
        "impact_opacity": impact_opacity,
        "impact_scale": impact_scale,
        "heart_scale": heart_scale,
        "heart_opacity": heart_opacity,
        "heart_progress": heart_progress,
    }


def render_frames(layers: dict) -> list[Image.Image]:
    w, h = layers["canvas_size"]
    pin = layers["pin"]
    pin_center = layers["pin_center"]
    target = layers["target"]
    frames: list[Image.Image] = []

    for frame_number in range(FRAME_COUNT):
        frame = Image.new("RGBA", (w, h), (255, 255, 255, 255))
        state = animation_state(frame_number)
        pin_sprite = transform_sprite(pin, angle=state["pin_angle"])
        paste_center(
            frame,
            pin_sprite,
            (pin_center[0] + state["pin_shift"][0], pin_center[1] + state["pin_shift"][1]),
        )

        for effect in [layers["arc"], *layers["strokes"]]:
            sprite = transform_sprite(effect["crop"], scale=state["impact_scale"])
            center = effect["center"]
            scaled_center = (
                target[0] + (center[0] - target[0]) * state["impact_scale"],
                target[1] + (center[1] - target[1]) * state["impact_scale"],
            )
            paste_center(frame, sprite, scaled_center, state["impact_opacity"])

        for index, heart in enumerate(layers["hearts"]):
            heart_state = animation_state(frame_number, index)
            sprite = transform_sprite(heart["crop"], scale=heart_state["heart_scale"])
            final_center = heart["center"]
            progress = heart_state["heart_progress"]
            current_center = (
                target[0] + (final_center[0] - target[0]) * progress,
                target[1] + (final_center[1] - target[1]) * progress,
            )
            paste_center(frame, sprite, current_center, heart_state["heart_opacity"])

        frames.append(frame.convert("RGB"))
    return frames


def boundary_loops(mask: np.ndarray) -> list[list[tuple[float, float]]]:
    h, w = mask.shape
    edges: dict[tuple[int, int], list[tuple[int, int]]] = {}

    def add_edge(start: tuple[int, int], end: tuple[int, int]) -> None:
        edges.setdefault(start, []).append(end)

    ys, xs = np.where(mask)
    for y, x in zip(ys.tolist(), xs.tolist()):
        if y == 0 or not mask[y - 1, x]:
            add_edge((x, y), (x + 1, y))
        if x == w - 1 or not mask[y, x + 1]:
            add_edge((x + 1, y), (x + 1, y + 1))
        if y == h - 1 or not mask[y + 1, x]:
            add_edge((x + 1, y + 1), (x, y + 1))
        if x == 0 or not mask[y, x - 1]:
            add_edge((x, y + 1), (x, y))

    loops: list[list[tuple[float, float]]] = []
    while edges:
        start = next(iter(edges))
        current = start
        loop = [start]
        guard = 0
        while guard < 100000:
            guard += 1
            destinations = edges.get(current)
            if not destinations:
                break
            nxt = destinations.pop()
            if not destinations:
                edges.pop(current, None)
            current = nxt
            if current == start:
                break
            loop.append(current)
        if len(loop) >= 8 and current == start:
            loops.append([(float(x), float(y)) for x, y in loop])
    return loops


def perpendicular_distance(point, start, end) -> float:
    px, py = point
    sx, sy = start
    ex, ey = end
    dx, dy = ex - sx, ey - sy
    if dx == 0 and dy == 0:
        return math.hypot(px - sx, py - sy)
    return abs(dy * px - dx * py + ex * sy - ey * sx) / math.hypot(dx, dy)


def rdp(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    max_distance = 0.0
    index = 0
    for i in range(1, len(points) - 1):
        distance = perpendicular_distance(points[i], points[0], points[-1])
        if distance > max_distance:
            index, max_distance = i, distance
    if max_distance > epsilon:
        left = rdp(points[: index + 1], epsilon)
        right = rdp(points[index:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]


def component_color(image: Image.Image, mask: np.ndarray) -> list[float]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    values = rgb[mask]
    median = np.median(values, axis=0) / 255.0
    return [round(float(value), 4) for value in median]


def shape_group(mask: np.ndarray, image: Image.Image, name: str, center: tuple[float, float]) -> dict:
    loops = boundary_loops(mask)
    if not loops:
        raise ValueError(f"No contour found for {name}")
    loop = max(loops, key=len)
    loop.append(loop[0])
    simplified = rdp(loop, 1.4)
    if simplified[-1] == simplified[0]:
        simplified = simplified[:-1]
    vertices = [[round(x - center[0], 2), round(y - center[1], 2)] for x, y in simplified]
    zeros = [[0, 0] for _ in vertices]
    return {
        "ty": "gr",
        "nm": name,
        "it": [
            {"ty": "sh", "nm": f"{name} Path", "ks": {"a": 0, "k": {"i": zeros, "o": zeros, "v": vertices, "c": True}}},
            {"ty": "fl", "nm": f"{name} Fill", "c": {"a": 0, "k": component_color(image, mask)}, "o": {"a": 0, "k": 100}, "r": 1},
            {"ty": "tr", "p": {"a": 0, "k": [0, 0]}, "a": {"a": 0, "k": [0, 0]}, "s": {"a": 0, "k": [100, 100]}, "r": {"a": 0, "k": 0}, "o": {"a": 0, "k": 100}},
        ],
    }


def keyframes(values: list[tuple[int, list[float]]]) -> dict:
    entries = []
    for index, (time, value) in enumerate(values):
        entry = {"t": time, "s": value}
        if index < len(values) - 1:
            entry["e"] = values[index + 1][1]
            entry["i"] = {"x": [0.667] * len(value), "y": [1.0] * len(value)}
            entry["o"] = {"x": [0.333] * len(value), "y": [0.0] * len(value)}
        entries.append(entry)
    return {"a": 1, "k": entries}


def lottie_layer(index: int, name: str, shape: dict, center: tuple[float, float], position, scale, rotation, opacity) -> dict:
    return {
        "ddd": 0,
        "ind": index,
        "ty": 4,
        "nm": name,
        "sr": 1,
        "ks": {
            "o": opacity,
            "r": rotation,
            "p": position,
            "a": {"a": 0, "k": [0, 0, 0]},
            "s": scale,
        },
        "ao": 0,
        "shapes": [shape],
        "ip": 0,
        "op": FRAME_COUNT,
        "st": 0,
        "bm": 0,
    }


def make_lottie(layers: dict, final_image: Image.Image, effect_image: Image.Image) -> dict:
    w, h = layers["canvas_size"]
    result_layers = []
    layer_index = 1

    pin_canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    paste_center(pin_canvas, layers["pin"], layers["pin_center"])
    pin_mask = np.asarray(pin_canvas.getchannel("A")) > 12
    pin_center = layers["pin_center"]
    pin_shape = shape_group(pin_mask, final_image, "Pin", pin_center)
    result_layers.append(
        lottie_layer(
            layer_index,
            "Pin",
            pin_shape,
            pin_center,
            keyframes([(0, [pin_center[0] - 34, pin_center[1] - 42, 0]), (14, [pin_center[0], pin_center[1], 0]), (43, [pin_center[0], pin_center[1], 0]), (53, [pin_center[0] - 34, pin_center[1] - 42, 0])]),
            {"a": 0, "k": [100, 100, 100]},
            keyframes([(0, [5.5]), (14, [0]), (43, [0]), (53, [5.5])]),
            {"a": 0, "k": 100},
        )
    )
    layer_index += 1

    effect_items = [layers["arc"], *layers["strokes"]]
    for effect_number, effect in enumerate(effect_items):
        center = effect["center"]
        shape = shape_group(effect["mask"], effect_image, f"Impact {effect_number + 1}", center)
        result_layers.append(
            lottie_layer(
                layer_index,
                f"Impact {effect_number + 1}",
                shape,
                center,
                {"a": 0, "k": [center[0], center[1], 0]},
                keyframes([(0, [72, 72, 100]), (10, [72, 72, 100]), (16, [106, 106, 100]), (21, [100, 100, 100]), (43, [100, 100, 100]), (53, [72, 72, 100])]),
                {"a": 0, "k": 0},
                keyframes([(0, [0]), (10, [0]), (16, [100]), (43, [100]), (53, [0])]),
            )
        )
        layer_index += 1

    target = layers["target"]
    for heart_number, heart in enumerate(layers["hearts"]):
        center = heart["center"]
        shape = shape_group(heart["mask"], effect_image, f"Heart {heart_number + 1}", center)
        start = 13 + heart_number * 3
        result_layers.append(
            lottie_layer(
                layer_index,
                f"Heart {heart_number + 1}",
                shape,
                center,
                keyframes([(0, [target[0], target[1], 0]), (start, [target[0], target[1], 0]), (start + 8, [center[0], center[1], 0]), (43, [center[0], center[1], 0]), (53, [center[0], center[1], 0])]),
                keyframes([(0, [0, 0, 100]), (start, [0, 0, 100]), (start + 6, [112, 112, 100]), (start + 9, [100, 100, 100]), (53, [100, 100, 100])]),
                {"a": 0, "k": 0},
                keyframes([(0, [0]), (start, [0]), (start + 6, [100]), (43, [100]), (53, [0])]),
            )
        )
        layer_index += 1

    return {
        "v": "5.12.2",
        "fr": FPS,
        "ip": 0,
        "op": FRAME_COUNT,
        "w": w,
        "h": h,
        "nm": "PinMe Logo Impact",
        "ddd": 0,
        "assets": [],
        "layers": result_layers,
        "markers": [],
    }


def make_contact_sheet(frames: list[Image.Image]) -> Image.Image:
    indices = [0, 8, 14, 19, 27, 36, 45, 53]
    thumb_size = 260
    sheet = Image.new("RGB", (thumb_size * 4, thumb_size * 2), "white")
    draw = ImageDraw.Draw(sheet)
    for slot, frame_index in enumerate(indices):
        thumb = frames[frame_index].resize((thumb_size, thumb_size), Image.Resampling.LANCZOS)
        x = (slot % 4) * thumb_size
        y = (slot // 4) * thumb_size
        sheet.paste(thumb, (x, y))
        draw.text((x + 10, y + 10), f"{frame_index / FPS:.2f}s", fill=(16, 17, 22))
    return sheet


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    layers = extract_layers()
    frames = render_frames(layers)

    gif_path = OUT_DIR / "pinme-logo-motion.gif"
    gif_frames = [frame.resize(GIF_SIZE, Image.Resampling.LANCZOS) for frame in frames]
    gif_frames[0].save(
        gif_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=round(1000 / FPS),
        loop=0,
        optimize=False,
        disposal=2,
    )

    poster_path = OUT_DIR / "pinme-logo-final.png"
    frames[36].save(poster_path)

    contact_path = OUT_DIR / "pinme-logo-motion-contact-sheet.png"
    make_contact_sheet(frames).save(contact_path)

    final_image = Image.open(poster_path).convert("RGBA")
    effect_image = Image.open(SOURCE_EFFECT).convert("RGBA")
    lottie = make_lottie(layers, final_image, effect_image)
    lottie_path = OUT_DIR / "pinme-logo-motion.json"
    lottie_path.write_text(json.dumps(lottie, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Lightweight verification.
    with Image.open(gif_path) as gif:
        stored_frames = getattr(gif, "n_frames", 1)
        total_duration_ms = 0
        for frame_index in range(stored_frames):
            gif.seek(frame_index)
            total_duration_ms += int(gif.info.get("duration", 0))
        # GIF encoders legitimately coalesce identical hold frames. Validate the
        # visible timeline instead of requiring every source frame to be stored.
        if stored_frames < 24 or not 1500 <= total_duration_ms <= 2000:
            raise ValueError("GIF timeline validation failed")
        if gif.size != GIF_SIZE:
            raise ValueError("GIF canvas size mismatch")
    loaded = json.loads(lottie_path.read_text(encoding="utf-8"))
    if loaded["fr"] != FPS or loaded["op"] != FRAME_COUNT or len(loaded["layers"]) != 7:
        raise ValueError("Lottie structure validation failed")

    print(f"GIF={gif_path}")
    print(f"LOTTIE={lottie_path}")
    print(f"POSTER={poster_path}")
    print(f"CONTACT_SHEET={contact_path}")
    print(f"FRAMES={FRAME_COUNT} FPS={FPS} DURATION={FRAME_COUNT / FPS:.2f}s")
    print(f"GIF_STORED_FRAMES={stored_frames} GIF_DURATION={total_duration_ms / 1000:.2f}s")


if __name__ == "__main__":
    main()
