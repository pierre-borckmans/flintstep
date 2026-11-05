package mapping

import (
	"math"
	"slices"
	"sort"
)

// RESPONSE CURVES: how the pedal's travel becomes the value that goes out.
//
// Many expression pedals use an audio-taper pot, so the raw value races through its
// first half in a few degrees near the heel and crawls near the toe. Mapped straight,
// that feels coarse at the bottom and needlessly fine at the top. A curve bends the
// calibrated, inverted travel t (0 heel .. 1 toe) before it is quantised to 0..127,
// so the hysteresis and the triggers both work on what the DAW receives.
//
// Every curve is non-decreasing (strictly increasing except where a Custom curve is
// drawn flat), maps 0 to 0 and 1 to 1 exactly, and costs a few float operations. frontend/src/lib/exp.ts mirrors this file,
// and frontend/src/lib/curves.golden.json pins both to the same numbers.

// CurveKind names a response curve.
type CurveKind string

// Curve kinds.
const (
	// CurveLinear sends the travel as it is.
	CurveLinear CurveKind = "linear"
	// CurveGentle gives the heel end more resolution: the first half of the travel
	// covers about the first fifth of the output. For pedals that jump at the bottom.
	CurveGentle CurveKind = "gentle"
	// CurveFast is Gentle mirrored: quick off the heel, fine near the toe.
	CurveFast CurveKind = "fast"
	// CurveS is fine at both ends and quicker through the middle. Strength says how
	// much (0 linear, 1 fully flat ends) and Centre where the steep part sits.
	CurveS CurveKind = "s"
	// CurveCustom is the user's own curve: through Points when there are any (a smooth
	// curve that never goes back down), otherwise the exponential family with Amount.
	CurveCustom CurveKind = "custom"
)

// ExpCurve is an expression input's response curve. Amount only shapes "custom"; the
// other kinds keep it, so going back to Custom finds the shape the user left.
type ExpCurve struct {
	Kind   CurveKind `json:"kind"`
	Amount float64   `json:"amount"` // custom without points, -1..1: 0 linear, >0 gentle, <0 fast
	// Strength and Centre shape "s": Strength 0..1 (0 linear, 1 flat ends), Centre
	// 0.1..0.9, where along the travel the steep middle sits. Zero for both (files from
	// before they existed) is the old default S: strength 0.6, centre 0.5.
	Strength float64 `json:"strength,omitempty"`
	Centre   float64 `json:"centre,omitempty"`
	// Points shape "custom": interior points (x = travel, y = output, both 0..1), x
	// increasing. The ends (0,0) and (1,1) are implied. See monotone.
	Points []CurvePoint `json:"points,omitempty"`
}

// Equal reports whether two curves are the same (the struct holds a slice, so == is
// not available).
func (c ExpCurve) Equal(o ExpCurve) bool {
	return c.Kind == o.Kind && c.Amount == o.Amount && c.Strength == o.Strength &&
		c.Centre == o.Centre && slices.Equal(c.Points, o.Points)
}

// CurvePoint is one point a Custom curve passes through.
type CurvePoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

const (
	// curveSteep is the exponent k at Amount ±1. Past about 5 the first tenth of the
	// travel rounds to nothing and the pedal feels dead at the heel.
	curveSteep = 5.0
	// presetAmount is Gentle's Amount on the custom scale (Fast is its negative): k = 3,
	// which puts half the travel at 23 of 127.
	presetAmount = 0.6
	// sStrength and sCentre are the S curve's defaults: what "s" was before it had
	// controls (0.6 of an S, centred), so older presets keep their feel.
	sStrength = 0.6
	sCentre   = 0.5
	// sPower is the S shape's exponent on each side of the centre: 3 flattens the ends
	// like a smoothstep does.
	sPower = 3.0
	// MaxCurvePoints caps a Custom curve's interior points; minPointGap keeps two from
	// sitting on top of each other (which would make the curve a cliff).
	MaxCurvePoints = 8
	minPointGap    = 0.02
)

func validCurve(k CurveKind) bool {
	switch k {
	case CurveLinear, CurveGentle, CurveFast, CurveS, CurveCustom:
		return true
	}
	return false
}

// normalize: no kind (files before version 4) or one this version does not know is
// linear; Amount is clamped to -1..1, and a NaN or infinity is 0.
func (c ExpCurve) normalize() ExpCurve {
	if !validCurve(c.Kind) {
		c.Kind = CurveLinear
	}
	if math.IsNaN(c.Amount) || math.IsInf(c.Amount, 0) {
		c.Amount = 0
	}
	c.Amount = math.Min(math.Max(c.Amount, -1), 1)
	// Zero for both is "the default S" and stays zero (resolved in Apply), so older
	// presets and the defaults compare equal to what they were.
	if c.Strength != 0 || c.Centre != 0 {
		c.Strength = clampFinite(c.Strength, 0, 1, sStrength)
		c.Centre = clampFinite(orDefaultF(c.Centre, sCentre), 0.1, 0.9, sCentre)
	}
	c.Points = normalizePoints(c.Points)
	return c
}

func orDefaultF(v, def float64) float64 {
	if v == 0 {
		return def
	}
	return v
}

func clampFinite(v, lo, hi, def float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return def
	}
	return math.Min(math.Max(v, lo), hi)
}

// normalizePoints sorts the points by x, keeps them strictly inside 0..1 and at least
// minPointGap apart (and from the ends), clamps y to 0..1 and makes the y values
// non-decreasing, so the curve can never send a lower value for more travel. At most
// MaxCurvePoints.
func normalizePoints(in []CurvePoint) []CurvePoint {
	if len(in) == 0 {
		return nil
	}
	ps := make([]CurvePoint, 0, len(in))
	for _, p := range in {
		if math.IsNaN(p.X) || math.IsNaN(p.Y) || math.IsInf(p.X, 0) || math.IsInf(p.Y, 0) {
			continue
		}
		ps = append(ps, CurvePoint{X: p.X, Y: math.Min(math.Max(p.Y, 0), 1)})
	}
	sort.SliceStable(ps, func(i, j int) bool { return ps[i].X < ps[j].X })
	out := make([]CurvePoint, 0, len(ps))
	prevX, prevY := 0.0, 0.0
	for _, p := range ps {
		if p.X < minPointGap || p.X > 1-minPointGap || p.X-prevX < minPointGap {
			continue
		}
		p.Y = math.Max(p.Y, prevY)
		out = append(out, p)
		prevX, prevY = p.X, p.Y
		if len(out) == MaxCurvePoints {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// sCurve is the S shape with strength m and centre c: a blend of linear and two power
// curves meeting at (c, c), flat at both ends for m = 1. Monotonic for m in 0..1.
func sCurve(t, m, c float64) float64 {
	var s float64
	if t <= c {
		s = c * math.Pow(t/c, sPower)
	} else {
		s = 1 - (1-c)*math.Pow((1-t)/(1-c), sPower)
	}
	return (1-m)*t + m*s
}

// monotone is the Fritsch-Carlson monotone cubic through (0,0), the points and (1,1):
// smooth, passes through every point, and never overshoots, so it only ever rises (or
// stays flat where two points are level).
func monotone(t float64, pts []CurvePoint) float64 {
	xs := make([]float64, 0, len(pts)+2)
	ys := make([]float64, 0, len(pts)+2)
	xs, ys = append(xs, 0), append(ys, 0)
	for _, p := range pts {
		xs, ys = append(xs, p.X), append(ys, p.Y)
	}
	xs, ys = append(xs, 1), append(ys, 1)
	n := len(xs)
	d := make([]float64, n-1) // secant slopes
	for i := 0; i < n-1; i++ {
		d[i] = (ys[i+1] - ys[i]) / (xs[i+1] - xs[i])
	}
	m := make([]float64, n) // tangents
	m[0], m[n-1] = d[0], d[n-2]
	for i := 1; i < n-1; i++ {
		if d[i-1]*d[i] <= 0 {
			m[i] = 0
		} else {
			m[i] = (d[i-1] + d[i]) / 2
		}
	}
	for i := 0; i < n-1; i++ {
		if d[i] == 0 {
			m[i], m[i+1] = 0, 0
			continue
		}
		a, b := m[i]/d[i], m[i+1]/d[i]
		if h := a*a + b*b; h > 9 {
			k := 3 / math.Sqrt(h)
			m[i], m[i+1] = k*a*d[i], k*b*d[i]
		}
	}
	i := 0
	for i < n-2 && t > xs[i+1] {
		i++
	}
	h := xs[i+1] - xs[i]
	u := (t - xs[i]) / h
	h00 := (1 + 2*u) * (1 - u) * (1 - u)
	h10 := u * (1 - u) * (1 - u)
	h01 := u * u * (3 - 2*u)
	h11 := u * u * (u - 1)
	return h00*ys[i] + h10*h*m[i] + h01*ys[i+1] + h11*h*m[i+1]
}

// expCurve is the normalised exponential (e^(k·t) - 1) / (e^k - 1): convex for k > 0,
// concave for k < 0, the identity in the limit k → 0. expCurve(t, -k) = 1 - expCurve(1-t, k),
// so Gentle and Fast are mirror images.
func expCurve(t, k float64) float64 {
	if math.Abs(k) < 1e-9 {
		return t
	}
	return math.Expm1(k*t) / math.Expm1(k)
}

// Apply bends travel t (clamped to 0..1) through the curve.
func (c ExpCurve) Apply(t float64) float64 {
	if !(t > 0) { // also NaN
		return 0
	}
	if t >= 1 {
		return 1
	}
	var y float64
	switch c.Kind {
	case CurveGentle:
		y = expCurve(t, presetAmount*curveSteep)
	case CurveFast:
		y = expCurve(t, -presetAmount*curveSteep)
	case CurveS:
		m, ce := c.Strength, c.Centre
		if m == 0 && ce == 0 {
			m, ce = sStrength, sCentre
		}
		y = sCurve(t, clampFinite(m, 0, 1, sStrength), clampFinite(ce, 0.1, 0.9, sCentre))
	case CurveCustom:
		if len(c.Points) > 0 {
			y = monotone(t, c.Points)
		} else {
			y = expCurve(t, math.Min(math.Max(c.Amount, -1), 1)*curveSteep)
		}
	default:
		y = t
	}
	return math.Min(math.Max(y, 0), 1)
}

// curveScaled runs a travel in the engine's units (0..ExpRawMax) through the curve.
func (c ExpCurve) curveScaled(scaled int) int {
	if c.Kind == CurveLinear || c.Kind == "" {
		return scaled
	}
	return int(math.Round(c.Apply(float64(scaled)/ExpRawMax) * ExpRawMax))
}
