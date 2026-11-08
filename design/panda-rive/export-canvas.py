"""Convert Pandafit's Panda artboard to local Canvas paths and motion tracks."""

from math import cos, sin
import json
from pathlib import Path
from xml.etree import ElementTree

HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parents[1] / "src/tracking/ui/panda-motion.ts"
POSE_PROPS = ("x", "y", "rotation", "scaleX", "scaleY", "opacity")
NEUTRAL = (0, 0, 0, 1, 1, 1)
EASING = {"hold": 0, "linear": 1, "cubic": 2}


def number(node, attr, default=0):
    return float(node.get(attr, default))


def short(value):
    return format(round(value, 5) or 0, "g")


def point(x, y):
    return f"{short(x)} {short(y)}"


def ellipse_path(node):
    rx, ry = number(node, "width") / 2, number(node, "height") / 2
    x = number(node, "x") + rx * (1 - 2 * number(node, "originX", 0.5))
    y = number(node, "y") + ry * (1 - 2 * number(node, "originY", 0.5))
    left, right = point(x - rx, y), point(x + rx, y)
    arc = f"A{point(rx, ry)} 0 1 0"
    return f"M{left}{arc} {right}{arc} {left}Z"


def contour_path(node):
    vertices = list(node)
    if not vertices or any(v.tag not in ("StraightVertex", "CubicDetachedVertex") for v in vertices):
        raise ValueError("Panda contours need straight or detached cubic vertices")

    def xy(v):
        return number(v, "x"), number(v, "y")

    def handle(v, side):
        x, y = xy(v)
        rotation, length = number(v, side + "Rotation"), number(v, side + "Distance")
        return point(x + cos(rotation) * length, y + sin(rotation) * length)

    closed = node.get("isClosed") == "true"
    pairs = zip(vertices, vertices[1:] + ([vertices[0]] if closed else []))
    commands = ["M" + point(*xy(vertices[0]))]
    for start, end in pairs:
        if number(start, "outDistance") or number(end, "inDistance"):
            commands.append(f"C{handle(start, 'out')} {handle(end, 'in')} {point(*xy(end))}")
        else:
            commands.append("L" + point(*xy(end)))
    return "".join(commands) + ("Z" if closed else "")


def paint_color(node):
    argb = node.find("SolidColor").attrib["colorValue"]
    return "#" + argb[2:] + (argb[:2] if argb[:2] != "FF" else "")


def shape(node):
    paths = []
    style = {}
    for child in node:
        if child.tag == "Ellipse":
            paths.append(ellipse_path(child))
        elif child.tag == "PointsPath":
            paths.append(contour_path(child))
        elif child.tag == "Fill":
            style["fill"] = paint_color(child)
        elif child.tag == "Stroke":
            style["stroke"] = [
                paint_color(child), number(child, "thickness"),
                child.get("cap", "butt"), child.get("join", "miter"),
            ]
        else:
            raise ValueError(f"Unsupported Panda shape element: {child.tag}")
    return {"path": "".join(paths), **style}


def scene(artboard):
    nodes, indices = [], {}

    def convert(node):
        index = len(nodes)
        data = {"pose": [number(node, prop, default) for prop, default in zip(POSE_PROPS, NEUTRAL)]}
        nodes.append(data)
        if "id" in node.attrib:
            indices[node.attrib["id"]] = index
        if node.tag == "Shape":
            data["paint"] = shape(node)
        elif node.tag == "Node":
            # Rive draws its first declared child on top. Canvas paints back to front.
            data["children"] = [convert(child) for child in reversed(list(node))]
        else:
            raise ValueError(f"Unsupported Panda scene element: {node.tag}")
        return index

    roots = [
        convert(node) for node in reversed(list(artboard))
        if node.tag not in ("StateMachine", "LinearAnimation")
    ]
    return roots, nodes, indices


def clips(artboard, view_model, nodes, indices):
    layer = artboard.find("StateMachine/StateMachineLayer")
    states = {node.get("id"): node.get("animationId") for node in layer.findall("AnimationState")}
    animations = {node.get("id"): node for node in artboard.findall("LinearAnimation")}
    triggers = {node.get("id"): node.get("name") for node in view_model.findall("ViewModelPropertyTrigger")}
    result = {}
    for transition in layer.findall("AnyState/StateTransition"):
        bind = transition.find(".//DataBindContext")
        gesture = triggers[bind.attrib["sourcePathIds"].split("-")[-1]]
        animation = animations[states[transition.attrib["stateToId"]]]
        tracks = []
        for keyed_object in animation.findall("KeyedObject"):
            index = indices[keyed_object.attrib["objectId"]]
            for prop in keyed_object.findall("KeyedProperty"):
                property_index = POSE_PROPS.index(prop.attrib["property"])
                keys = []
                for key in prop:
                    interpolation = key.attrib["interpolationType"]
                    if interpolation == "cubic":
                        curve = key.find("CubicEaseInterpolator")
                        if tuple(number(curve, k) for k in ("x1", "y1", "x2", "y2")) != (.42, 0, .58, 1):
                            raise ValueError("Panda uses the standard ease-in-out curve")
                    keys.append([int(key.attrib["frame"]), number(key, "value"), EASING[interpolation]])
                if any(value != nodes[index]["pose"][property_index] for _, value, _ in keys):
                    tracks.append([index, property_index, keys])
        result[gesture] = {
            "frames": int(animation.attrib["duration"]),
            "fps": int(animation.attrib["fps"]),
            "tracks": tracks,
        }
    if set(result) != set(triggers.values()):
        raise ValueError("A Panda gesture is missing its animation")
    return result


def compact(value):
    return json.dumps(value, separators=(",", ":"))


def clip_source(gesture, clip):
    return (
        f"    {gesture}: {{frames: {clip['frames']}, fps: {clip['fps']}, tracks: [\n"
        + "".join(f"      {compact(track)},\n" for track in clip["tracks"])
        + "    ]},\n"
    )


def main():
    source = ElementTree.parse(HERE / "scene.rml").getroot()
    artboard = source.find("Artboard")
    roots, nodes, indices = scene(artboard)
    data = {
        "width": int(artboard.attrib["width"]), "height": int(artboard.attrib["height"]),
        "roots": roots, "nodes": nodes, "clips": clips(artboard, source.find("ViewModel"), nodes, indices),
    }
    OUTPUT.write_text(
        "// Generated by design/panda-rive/export-canvas.py from scene.rml.\n"
        "import type { PandaMotion } from './panda-canvas';\n\n"
        "export const pandaMotion: PandaMotion = {\n"
        f"  width: {data['width']}, height: {data['height']}, roots: {compact(roots)},\n"
        "  nodes: [\n" + "".join(f"    {compact(node)},\n" for node in nodes) + "  ],\n"
        "  clips: {\n" + "".join(clip_source(gesture, clip) for gesture, clip in data["clips"].items()) + "  },\n"
        "};\n", encoding="utf-8",
    )


if __name__ == "__main__":
    main()
