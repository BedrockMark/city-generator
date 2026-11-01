"""Semantic classes for sprites (by name/pack keywords) and for ground cells (by base tile colour / source).

Kept deliberately simple & editable: CLASS_RULES is an ordered list, first match wins.
"""
import re, json
import numpy as np
from common import *

CLASS_RULES = [
    ('vehicle',       r'(^|_)(Car|Bus|Truck|Van|Ambulance|Taxi|Police_Car|Motorbike|Bike|Bicycle|Scooter|Trailer|Camper|Pickup|Jeep|Tractor|Excavator|Bulldozer|Forklift|Train|Tram|Helicopter)(_|$)'),
    ('traffic_light', r'Traffic_Light'),
    ('traffic_sign',  r'Traffic_Sign|Danger_Sign|Stop_Barrier|Road_Sign'),
    ('info_sign',     r'Info_Sign|Sign|Billboard|Poster|Flyer|Board'),
    ('street_lamp',   r'Street_Lamp|Lamp|Light_Pole|Lamppost|Floodlight|Spotlight'),
    ('bench',         r'Bench|Chair|Seat|Armchair|Stool|Sunbed|Deck_Chair'),
    ('table',         r'Table|Counter|Stand|Stall|Cart|Kiosk'),
    ('trash',         r'Trash|Dumpster|Garbage|Junk|Bin(_|$)|Can_Trash|Bag'),
    ('hydrant',       r'Hydrant'),
    ('manhole',       r'Manhole|Grate|Drain|Sewer'),
    ('bollard',       r'Pedestrian_Barrier|Stake|Bollard|Post(_|$)|Pole|Barrier|Cone|Traffic_Barrier'),
    ('utility',       r'ATM|Phone_Booth|Vending|Parking_Meter|Mailbox|Electric_Box|EV_Charging|Fountain|Drinking|Water_Tower|Antenna|Solar|Air_Conditioner|Air_Unit|Air_Duct|Pipe|Clothes'),
    ('tree',          r'Tree|Palm|Pine|Fir|Oak'),
    ('plant',         r'Shrub|Bush|Hedge|Flower|Plant|Pot|Vase|Planter|Grass|Sprout|Cactus|Ivy'),
    ('fence',         r'Fence|Wall|Railing|Gate|Banister|Barbed'),
    ('crate',         r'Box|Crate|Barrel|Package|Pallet|Tire|Brick|Scrap|Container'),
    ('building',      r'Building|House|Condo|Shop|Store|Floor|Roof|Mall|Market|Hotel|Hospital|School|Office|Station|Villa|Garage|Bakery|Butchery|Gym|Tower|Shack|Hut|Church|Chapel|Corridor|Door|Window|Balcony|Awning|Tent|Facade|Entrance|Stairs'),
]
_rx = [(c, re.compile(p, re.I)) for c, p in CLASS_RULES]

def sprite_class(name, pack=''):
    for c, rx in _rx:
        if rx.search(name): return c
    if pack.startswith('10_'): return 'vehicle'
    return 'other'

# ---- ground classes (per grid cell, from the base tile's colour statistics) ----
def ground_class(rgb_tile):
    """rgb_tile: (16,16,3) uint8 -> coarse class."""
    a = rgb_tile.reshape(-1, 3).astype(float)
    r, g, b = np.median(a, 0)
    mx, mn = max(r, g, b), min(r, g, b)
    sat = (mx - mn) / (mx + 1e-6)
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    if b > r + 25 and b > g - 10 and b > 120: return 'water'
    if g > r + 15 and g > b + 10: return 'grass'
    if sat < 0.12 and lum < 118: return 'road'
    if sat < 0.25 and lum >= 118: return 'paved'
    if r > g > b and sat >= 0.25 and lum > 120: return 'sand'
    if r > g > b and sat >= 0.2: return 'dirt'
    return 'other'

def ground_classes_for_grid(g, tiles):
    """g: grid json; tiles: tile_index tiles array -> (rows, cols) array of class strings ('' unknown)."""
    R, C = g['rows'], g['cols']
    out = np.full((R, C), '', dtype=object)
    for r in range(R):
        for c in range(C):
            v = g['cells'][r][c]
            if v: out[r, c] = ground_class(tiles[v[0], ..., :3])
    return out
