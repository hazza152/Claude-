"""Fits the tape-circumference factors in js/measure.js (CIRCUMFERENCE_MODEL) to ANSUR II.

ANSUR II (US Army anthropometric survey, 2012) measured 1,986 women with a tape and with
calipers at the same body levels. The photos give width and depth, like the calipers, so
the survey tells us how to turn those into what a tape reads.

Usage:
    python3 calibration/fit_ansur.py [path/to/ANSUR II FEMALE Public.csv]

Without a path the CSV is downloaded from a public GitHub mirror of the official files
(official source: https://www.openlab.psu.edu/ansur2/).
"""
import csv
import io
import math
import random
import statistics as st
import sys
import urllib.request

MIRROR = "https://raw.githubusercontent.com/senihberkay/US-Army-ANSUR-II/master/ANSUR%20II%20FEMALE%20Public.csv"


def ellipse(a, b):
    return math.pi * (3 * (a + b) - math.sqrt((3 * a + b) * (a + 3 * b)))


def load(path):
    if path:
        text = open(path, encoding="latin-1").read()
    else:
        text = urllib.request.urlopen(MIRROR).read().decode("latin-1")
    return list(csv.DictReader(io.StringIO(text)))


def section(rows, prefix):
    """(circumference, breadth, depth) in cm for each person."""
    return [tuple(float(r[prefix + k]) / 10 for k in ("circumference", "breadth", "depth")) for r in rows]


def fit_linear(data):
    """Least squares for factor = base + perDepthRatio * depth/breadth."""
    xs = [d / b for _, b, d in data]
    ys = [c / ellipse(b / 2, d / 2) for c, b, d in data]
    mx, my = st.mean(xs), st.mean(ys)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return my - slope * mx, slope


def predict(model, b, d):
    base, slope = model
    return (base + slope * d / b) * ellipse(b / 2, d / 2)


def cross_validate(data, fit, folds=5):
    idx = list(range(len(data)))
    random.Random(0).shuffle(idx)
    errors = []
    for k in range(folds):
        test = set(idx[k::folds])
        model = fit([data[i] for i in idx if i not in test])
        errors += [predict(model, data[i][1], data[i][2]) - data[i][0] for i in test]
    return errors


def describe(errors):
    abs_err = sorted(abs(e) for e in errors)
    return (f"bias {st.mean(errors):+.2f} cm, mean abs {st.mean(abs_err):.2f} cm, "
            f"90% within {abs_err[int(0.9 * len(abs_err))]:.2f} cm")


def main():
    rows = load(sys.argv[1] if len(sys.argv) > 1 else None)
    print(f"{len(rows)} women\n")
    constant = lambda data: (st.mean(c / ellipse(b / 2, d / 2) for c, b, d in data), 0.0)
    for name, prefix, fit in (("bust", "chest", fit_linear), ("underbust (waist stand-in)", "waist", constant)):
        data = section(rows, prefix)
        base, slope = fit(data)
        print(f"{name}: {{ base: {base:.4f}, perDepthRatio: {slope:.4f} }}")
        print(f"  plain ellipse:     {describe([predict((1, 0), b, d) - c for c, b, d in data])}")
        print(f"  fitted (5-fold CV): {describe(cross_validate(data, fit))}\n")


if __name__ == "__main__":
    main()
