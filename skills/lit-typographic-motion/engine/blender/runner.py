# lit-typographic-motion: the offline Blender rung. Blender runs this headless:
#   blender -b --factory-startup -P runner.py -- --scene scene.py --out DIR --width W --height H
#           --percent P --samples S --device METAL --fps F --seed N (--stills t,t,... | --frames 1-N)
# Cycles goes on the GPU (the wanted backend first, then any other that has a device, else the CPU,
# and the receipt names which). The film's scene.py then runs with the `lit` helpers in scope, and the
# runner renders one still per listed time (still-01.png ...) or the frame sequence (000001.png ...)
# and writes receipt.json: the Blender version, engine, device, samples, size and the files written.
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

GPU_BACKENDS = ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI")


def arguments():
    rest = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="runner.py")
    parser.add_argument("--scene", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--percent", type=int, default=100)
    parser.add_argument("--samples", type=int, default=128)
    parser.add_argument("--device", default="METAL")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--stills")
    parser.add_argument("--frames")
    return parser.parse_args(rest)


def use_gpu(scene, wanted):
    """Put Cycles on a GPU backend that has a device, the wanted one first; the CPU when none does."""
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in dict.fromkeys((wanted, *GPU_BACKENDS)):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.get_devices()
        chosen = [d for d in prefs.devices if d.type == backend]
        if chosen:
            for d in prefs.devices:
                d.use = d.type == backend
            scene.cycles.device = "GPU"
            return backend
    scene.cycles.device = "CPU"
    return "CPU"


def srgb_to_linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


class Lit:
    """What scene.py may call. Times are film seconds; the plate's first frame is frame 1."""

    def __init__(self, fps):
        self.fps = fps

    def frame(self, t):
        return int(round(t * self.fps)) + 1

    def key(self, obj, prop, t, value=None, index=-1):
        """Set obj.<prop> when a value is given, then keyframe it at film time t."""
        if value is not None:
            setattr(obj, prop, value)
        obj.keyframe_insert(data_path=prop, frame=self.frame(t), index=index)

    def rgb(self, color):
        """A #RRGGBB string, or a tuple already in linear space, as Blender's linear colour."""
        if not isinstance(color, str):
            return tuple(color)[:3]
        digits = color.lstrip("#")
        return tuple(srgb_to_linear(int(digits[i:i + 2], 16) / 255) for i in (0, 2, 4))

    def look_at(self, obj, target):
        aim = Vector(target) - obj.location
        obj.rotation_euler = aim.to_track_quat("-Z", "Y").to_euler()

    def material(self, name, color, roughness=0.4, metallic=0.0, emission=None, strength=0.0):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        shader = mat.node_tree.nodes["Principled BSDF"]
        shader.inputs["Base Color"].default_value = (*self.rgb(color), 1.0)
        shader.inputs["Roughness"].default_value = roughness
        shader.inputs["Metallic"].default_value = metallic
        if emission is not None:
            shader.inputs["Emission Color"].default_value = (*self.rgb(emission), 1.0)
            shader.inputs["Emission Strength"].default_value = strength
        return mat

    def rounded_box(self, name, size, radius=0.08, segments=6, material=None, location=(0, 0, 0)):
        """A box whose bevelled edges catch the light."""
        bpy.ops.mesh.primitive_cube_add(size=1, location=location)
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = size
        bpy.ops.object.transform_apply(scale=True)
        bevel = obj.modifiers.new("bevel", "BEVEL")
        bevel.width = radius
        bevel.segments = segments
        bevel.limit_method = "ANGLE"
        bpy.ops.object.shade_smooth()
        if material is not None:
            obj.data.materials.append(material)
        return obj

    def image_card(self, name, image_path, width=1.0, location=(0, 0, 0), emission=1.0):
        """A flat card showing a product image file at its own aspect ratio, lit from within."""
        image = bpy.data.images.load(os.path.abspath(image_path))
        w, h = image.size
        bpy.ops.mesh.primitive_plane_add(size=1, location=location)
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = (width, width * h / max(w, 1), 1)
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        shader = nodes["Principled BSDF"]
        links.new(texture.outputs["Color"], shader.inputs["Base Color"])
        links.new(texture.outputs["Color"], shader.inputs["Emission Color"])
        links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
        shader.inputs["Emission Strength"].default_value = emission
        obj.data.materials.append(mat)
        return obj

    def area_light(self, name, location, target=(0, 0, 0), power=400.0, size=2.0, color="#FFFFFF"):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = power
        data.size = size
        data.color = self.rgb(color)
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = location
        self.look_at(obj, target)
        return obj

    def camera(self, location, target=(0, 0, 0), lens=50.0, dof=None):
        """The scene camera aimed at target; dof=(focus_distance, f_stop) turns depth of field on."""
        data = bpy.data.cameras.new("camera")
        data.lens = lens
        if dof is not None:
            data.dof.use_dof = True
            data.dof.focus_distance, data.dof.aperture_fstop = dof
        obj = bpy.data.objects.new("camera", data)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = location
        self.look_at(obj, target)
        bpy.context.scene.camera = obj
        return obj

    def world(self, color, strength=1.0):
        scene = bpy.context.scene
        scene.world = scene.world or bpy.data.worlds.new("world")
        scene.world.use_nodes = True
        background = scene.world.node_tree.nodes["Background"]
        background.inputs["Color"].default_value = (*self.rgb(color), 1.0)
        background.inputs["Strength"].default_value = strength
        return scene.world


def configure(scene, a):
    scene.render.engine = "CYCLES"
    device = use_gpu(scene, a.device)
    scene.cycles.samples = a.samples
    scene.cycles.seed = a.seed
    scene.cycles.use_denoising = True
    scene.render.resolution_x = a.width
    scene.render.resolution_y = a.height
    scene.render.resolution_percentage = a.percent
    scene.render.fps = a.fps
    scene.render.use_motion_blur = True
    image = scene.render.image_settings
    image.file_format, image.color_mode, image.color_depth = "PNG", "RGB", "8"
    return device


def render_stills(scene, lit, a):
    names = []
    for index, t in enumerate(float(x) for x in a.stills.split(",")):
        scene.frame_set(lit.frame(t))
        names.append(f"still-{index + 1:02d}.png")
        scene.render.filepath = os.path.join(a.out, names[-1])
        bpy.ops.render.render(write_still=True)
    return names


def render_frames(scene, a):
    first, last = (int(x) for x in a.frames.split("-"))
    scene.frame_start, scene.frame_end = first, last
    scene.render.filepath = os.path.join(a.out, "######")
    bpy.ops.render.render(animation=True)
    return [f"{n:06d}.png" for n in range(first, last + 1)]


def main():
    a = arguments()
    os.makedirs(a.out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    device = configure(scene, a)
    lit = Lit(a.fps)
    with open(a.scene, encoding="utf-8") as handle:
        code = compile(handle.read(), a.scene, "exec")
    exec(code, {"bpy": bpy, "lit": lit, "math": math, "Vector": Vector, "__name__": "__main__", "__file__": a.scene})
    if scene.camera is None:
        raise SystemExit("scene.py made no camera: call lit.camera(...) or set bpy.context.scene.camera")
    scene.cycles.samples = a.samples  # the command line has the last word on quality
    scene.render.resolution_percentage = a.percent
    names = render_stills(scene, lit, a) if a.stills else render_frames(scene, a)
    receipt = {
        "blender": bpy.app.version_string, "engine": "CYCLES", "device": device, "samples": a.samples,
        "percent": a.percent, "width": a.width * a.percent // 100, "height": a.height * a.percent // 100,
        "fps": a.fps, "files": [n for n in names if os.path.exists(os.path.join(a.out, n))],
    }
    with open(os.path.join(a.out, "receipt.json"), "w", encoding="utf-8") as handle:
        json.dump(receipt, handle)


main()
