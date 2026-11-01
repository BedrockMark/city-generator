#!/bin/sh
# Full reference-analysis pipeline. Run from tools/.
set -e
uv run python extract_frames.py
uv run python normalize_refs.py
uv run python build_tile_index.py
uv run python build_catalog.py
uv run python crop_maps.py
uv run python grid_layer.py "$@"
uv run python grid_objects.py "$@"
uv run python detect_objects.py "$@"
