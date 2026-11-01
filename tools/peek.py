"""Print dominant colour of the first N rows/cols from each edge of a native ref."""
import sys
import numpy as np
from collections import Counter
from common import *
for name in sys.argv[1:]:
    a = load_rgba(REFS/f'{name}.png')[..., :3]
    print(name, a.shape)
    for lab, lines in (('top', [a[i] for i in range(8)]), ('bot', [a[-1-i] for i in range(14)]),
                       ('left', [a[:, i] for i in range(8)]), ('right', [a[:, -1-i] for i in range(8)])):
        out = []
        for l in lines:
            c, n = Counter(map(tuple, l)).most_common(1)[0]
            out.append(f"{c}:{n/len(l):.2f}")
        print(' ', lab, ' | '.join(out))
