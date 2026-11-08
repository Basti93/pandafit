# Panda coach motion

Open `scene.rml` with the Rive CLI from the repository root.

```sh
rive design/panda-rive --verify
rive design/panda-rive
```

The transparent artboard is named `Panda`. Its default state machine is `PandaCoach`, bound to the default instance of `CoachGestures`. Each View Model trigger plays one clip and returns to rest. The host provides the text and decides when to fire a trigger.

| Trigger | Gesture | Timeline at 60 fps |
| --- | --- | --- |
| `greet` | Lift the mug, blink and set the mug back down | 81 frames |
| `listen` | Tilt the head and blink | 44 frames |
| `nod` | Nod and settle | 53 frames |
| `breathe` | Let the shoulders rise and settle on a slow breath | 189 frames |
| `flex` | Set down the mug, flex both paws and pick it back up | 135 frames |
| `bike` | Pedal through two revolutions on a compact bike | 143 frames |
| `run` | Jog forward on short, rounded paws | 139 frames |
| `yoga` | Wobble and settle in tree pose | 170 frames |
| `read` | Read and turn one page with the covers facing out | 154 frames |
| `knit` | Work a short row with the scarf attached to the needle | 166 frames |

The head, eyelids, torso, mug, steam and left and right shoulder pivots are independently keyed. During `greet` the forearms rotate around fixed shoulder pivots. During `nod` the torso, paws and mug follow the head down. The artwork uses vector paths and the original Pandafit palette. The source has no external assets or scripts.

To drive the coach gestures in a headless preview:

```sh
printf '%s\n' \
  'advance 3' \
  'data greet=1' 'advance 31' 'screenshot /tmp/panda-greet.png' 'advance 65' \
  'data listen=1' 'advance 20' 'screenshot /tmp/panda-listen.png' 'advance 35' \
  'data nod=1' 'advance 24' 'screenshot /tmp/panda-nod.png' 'advance 40' \
  'data breathe=1' 'advance 81' 'screenshot /tmp/panda-breathe.png' 'advance 120' \
  'data flex=1' 'advance 63' 'screenshot /tmp/panda-flex.png' 'advance 84' 'quit' |
  rive design/panda-rive --commands
```

For an activity preview, replace the sequence with the desired trigger. This example captures the cycling pose.

```sh
printf '%s\n' 'advance 3' 'data bike=1' 'advance 76' 'screenshot /tmp/panda-bike.png' 'quit' |
  rive design/panda-rive --commands
```

## Runtime file

[`panda-coach.riv`](panda-coach.riv) is the local export. It contains all ten View Model triggers. It loads in Canvas Lite 2.49.4 with the named artboard and state machine above. The running, mug and knitting clips were played through the browser runtime using same-origin assets.

The Free Workspace export includes Rive's splash screen. The project has no scripts, so the CLI reports that there is no script bytecode to sign. To reproduce the local export with Rive CLI 1.9.2:

```sh
rive login
rive design/panda-rive --publish=local --output-dir=.
```

See the [CLI documentation](https://rive.app/docs/cli/overview) for account and export options.
