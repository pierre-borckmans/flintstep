package mapping

import "math"

// RESPONSE CURVES: how the pedal's travel becomes the value that goes out.
//
// Many expression pedals use an audio-taper pot, so the raw value races through its
// first half in a few degrees near the heel and crawls near the toe. Mapped straight,
// that feels coarse at the bottom and needlessly fine at the top. A curve bends the
// calibrated, inverted travel t (0 heel .. 1 toe) before it is quantised to 0..127,
// so the hysteresis and the triggers both work on what the DAW receives.
//
// Every curve is strictly increasing, maps 0 to 0 and 1 to 1 exactly, and costs a
// couple of float operations. frontend/src/lib/exp.ts mirrors this file, and
// frontend/src/lib/curves.golden.json pins both to the same numbers.

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
	// CurveS is fine at both ends and quicker through the middle.
	CurveS CurveKind = "s"
	// CurveCustom is the exponential family with the user's own Amount.
	CurveCustom CurveKind = "custom"
)

// ExpCurve is an expression input's response curve. Amount only shapes "custom"; the
// other kinds keep it, so going back to Custom finds the shape the user left.
type ExpCurve struct {
	Kind   CurveKind `json:"kind"`
	Amount float64   `json:"amount"` // custom only, -1..1: 0 linear, >0 gentle, <0 fast
}

const (
	// curveSteep is the exponent k at Amount ±1. Past about 5 the first tenth of the
	// travel rounds to nothing and the pedal feels dead at the heel.
	curveSteep = 5.0
	// presetAmount is Gentle's Amount on the custom scale (Fast is its negative): k = 3,
	// which puts half the travel at 23 of 127.
	presetAmount = 0.6
	// sBlend is how much of smoothstep the S curve takes; the rest is linear, so the
	// ends keep 0.4 of the linear slope instead of going flat.
	sBlend = 0.6
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
	return c
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
		y = (1-sBlend)*t + sBlend*t*t*(3-2*t)
	case CurveCustom:
		y = expCurve(t, math.Min(math.Max(c.Amount, -1), 1)*curveSteep)
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
