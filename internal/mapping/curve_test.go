package mapping

import (
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"
)

// goldenPath is the table frontend/src/lib/exp.test.ts checks too, so the Go curves and
// their TS mirror cannot drift apart. UPDATE_GOLDEN=1 go test ./internal/mapping
// rewrites it from this file's curves.
const goldenPath = "../../frontend/src/lib/curves.golden.json"

type goldenRow struct {
	Curve ExpCurve  `json:"curve"`
	Out   []float64 `json:"out"` // Apply at each input
	CC    []int     `json:"cc"`  // round(Apply * 127)
}

type golden struct {
	Note   string      `json:"note"`
	Inputs []float64   `json:"inputs"`
	Rows   []goldenRow `json:"rows"`
}

var goldenInputs = []float64{0, 0.01, 0.05, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 0.95, 0.99, 1}

var goldenCurves = []ExpCurve{
	{Kind: CurveLinear},
	{Kind: CurveGentle},
	{Kind: CurveFast},
	{Kind: CurveS},
	{Kind: CurveCustom, Amount: 0},
	{Kind: CurveCustom, Amount: 0.35},
	{Kind: CurveCustom, Amount: -0.35},
	{Kind: CurveCustom, Amount: 1},
	{Kind: CurveCustom, Amount: -1},
}

func buildGolden() golden {
	g := golden{
		Note:   "Written by internal/mapping/curve_test.go (UPDATE_GOLDEN=1); checked by Go and by exp.test.ts.",
		Inputs: goldenInputs,
	}
	for _, c := range goldenCurves {
		r := goldenRow{Curve: c}
		for _, t := range goldenInputs {
			y := c.Apply(t)
			r.Out = append(r.Out, y)
			r.CC = append(r.CC, int(math.Round(y*127)))
		}
		g.Rows = append(g.Rows, r)
	}
	return g
}

func TestCurveGolden(t *testing.T) {
	want := buildGolden()
	if os.Getenv("UPDATE_GOLDEN") != "" {
		b, err := json.MarshalIndent(want, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(goldenPath, append(b, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	b, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	var got golden
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Rows) != len(want.Rows) || len(got.Inputs) != len(want.Inputs) {
		t.Fatalf("golden table out of date: run UPDATE_GOLDEN=1 go test ./internal/mapping")
	}
	for i, r := range want.Rows {
		g := got.Rows[i]
		if g.Curve != r.Curve {
			t.Fatalf("row %d is %+v, want %+v", i, g.Curve, r.Curve)
		}
		for j := range r.Out {
			if math.Abs(g.Out[j]-r.Out[j]) > 1e-12 || g.CC[j] != r.CC[j] {
				t.Errorf("%+v at %v: table %v/%d, Go %v/%d", r.Curve, want.Inputs[j], g.Out[j], g.CC[j], r.Out[j], r.CC[j])
			}
		}
	}
}

// defaultGoldenPath is Default() as JSON, which frontend/src/lib/config.test.ts compares
// with its defaultConfig(). Rewritten with the curve table.
const defaultGoldenPath = "../../frontend/src/lib/default.golden.json"

func TestDefaultGolden(t *testing.T) {
	want, err := json.MarshalIndent(Default(), "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	want = append(want, '\n')
	if os.Getenv("UPDATE_GOLDEN") != "" {
		if err := os.WriteFile(defaultGoldenPath, want, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := os.ReadFile(defaultGoldenPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("%s is out of date: run UPDATE_GOLDEN=1 go test ./internal/mapping", defaultGoldenPath)
	}
}

func allCurves() []ExpCurve {
	out := []ExpCurve{{Kind: CurveLinear}, {Kind: CurveGentle}, {Kind: CurveFast}, {Kind: CurveS}}
	for a := -1.0; a <= 1.0001; a += 0.05 {
		out = append(out, ExpCurve{Kind: CurveCustom, Amount: a})
	}
	return out
}

func TestCurvesAreExactAtTheEnds(t *testing.T) {
	for _, c := range allCurves() {
		if c.Apply(0) != 0 || c.Apply(1) != 1 {
			t.Errorf("%+v: 0 -> %v, 1 -> %v", c, c.Apply(0), c.Apply(1))
		}
		if c.Apply(-0.5) != 0 || c.Apply(1.5) != 1 || c.Apply(math.NaN()) != 0 {
			t.Errorf("%+v does not clamp", c)
		}
		if c.curveScaled(0) != 0 || c.curveScaled(ExpRawMax) != ExpRawMax {
			t.Errorf("%+v: scaled ends moved", c)
		}
	}
}

func TestCurvesAreStrictlyIncreasing(t *testing.T) {
	for _, c := range allCurves() {
		prev := c.Apply(0)
		for i := 1; i <= 1000; i++ {
			y := c.Apply(float64(i) / 1000)
			if !(y > prev) {
				t.Fatalf("%+v: not increasing at %v (%v after %v)", c, float64(i)/1000, y, prev)
			}
			prev = y
		}
	}
}

func TestCurveShapes(t *testing.T) {
	gentle, fast := ExpCurve{Kind: CurveGentle}, ExpCurve{Kind: CurveFast}
	s := ExpCurve{Kind: CurveS}
	// Gentle: half the travel gives about a fifth of the output, so the heel end is fine.
	if y := gentle.Apply(0.5); y < 0.15 || y > 0.25 {
		t.Errorf("gentle(0.5) = %v", y)
	}
	for i := 1; i < 100; i++ {
		x := float64(i) / 100
		// Fast is Gentle mirrored; S is symmetric about the middle.
		if d := fast.Apply(x) - (1 - gentle.Apply(1-x)); math.Abs(d) > 1e-12 {
			t.Errorf("fast(%v) is not gentle mirrored (off by %v)", x, d)
		}
		if d := s.Apply(x) - (1 - s.Apply(1-x)); math.Abs(d) > 1e-12 {
			t.Errorf("s(%v) is not symmetric (off by %v)", x, d)
		}
		if gentle.Apply(x) >= x || fast.Apply(x) <= x {
			t.Errorf("gentle/fast on the wrong side of linear at %v", x)
		}
		// Custom at 0 is linear; custom at Gentle's amount is Gentle.
		if c := (ExpCurve{Kind: CurveCustom}).Apply(x); math.Abs(c-x) > 1e-12 {
			t.Errorf("custom 0 at %v = %v", x, c)
		}
		if c := (ExpCurve{Kind: CurveCustom, Amount: presetAmount}).Apply(x); math.Abs(c-gentle.Apply(x)) > 1e-12 {
			t.Errorf("custom %v is not gentle at %v", presetAmount, x)
		}
	}
	// S is finer than linear near both ends and steeper in the middle.
	if s.Apply(0.1) >= 0.1 || s.Apply(0.9) <= 0.9 || s.Apply(0.55)-s.Apply(0.45) <= 0.1 {
		t.Error("s is not an S")
	}
	// The custom family is continuous through linear.
	near := ExpCurve{Kind: CurveCustom, Amount: 1e-7}
	if math.Abs(near.Apply(0.3)-0.3) > 1e-6 {
		t.Errorf("custom near 0 jumps: %v", near.Apply(0.3))
	}
}

func TestCurveNormalize(t *testing.T) {
	cases := []struct {
		in, want ExpCurve
	}{
		{ExpCurve{}, ExpCurve{Kind: CurveLinear}},
		{ExpCurve{Kind: "wobbly", Amount: 0.2}, ExpCurve{Kind: CurveLinear, Amount: 0.2}},
		{ExpCurve{Kind: CurveCustom, Amount: 3}, ExpCurve{Kind: CurveCustom, Amount: 1}},
		{ExpCurve{Kind: CurveCustom, Amount: -3}, ExpCurve{Kind: CurveCustom, Amount: -1}},
		{ExpCurve{Kind: CurveCustom, Amount: math.NaN()}, ExpCurve{Kind: CurveCustom}},
		{ExpCurve{Kind: CurveGentle, Amount: 0.4}, ExpCurve{Kind: CurveGentle, Amount: 0.4}}, // kept for Custom
	}
	for _, c := range cases {
		if got := c.in.normalize(); got != c.want {
			t.Errorf("%+v -> %+v, want %+v", c.in, got, c.want)
		}
	}
}

// A file from before the curves (version 3) has none: linear, and the rest kept.
func TestOldConfigGetsLinearCurves(t *testing.T) {
	old := `{"version":3,"exp":[{"enabled":true,"channel":2,"cc":4,"min":80,"max":27280,"invert":false},
		{"enabled":false,"channel":1,"cc":7,"min":0,"max":65535,"invert":true}]}`
	var c Config
	if err := json.Unmarshal([]byte(old), &c); err != nil {
		t.Fatal(err)
	}
	c = c.Normalize()
	for n, x := range c.Exp {
		if x.Curve != (ExpCurve{Kind: CurveLinear}) {
			t.Errorf("exp %d curve %+v", n+1, x.Curve)
		}
	}
	if c.Exp[0].Max != 27280 || c.Exp[0].CC != 4 || !c.Exp[1].Invert || c.Version != ConfigVersion {
		t.Errorf("the rest of the old config was not kept: %+v", c.Exp)
	}
	if err := c.Validate(); err != nil {
		t.Error(err)
	}
}

func TestValidateRejectsAnUnknownCurve(t *testing.T) {
	c := Default()
	c.Exp[1].Curve.Kind = "wobbly"
	if err := c.Validate(); err == nil || err.Error() != `expression 2: unknown response curve "wobbly"` {
		t.Errorf("Validate = %v", err)
	}
	// Normalize is the forgiving one: a file from a newer version still runs.
	if err := c.Normalize().Validate(); err != nil {
		t.Errorf("normalized: %v", err)
	}
}

func TestCurveJSON(t *testing.T) {
	c := Default()
	c.Exp[0].Curve = ExpCurve{Kind: CurveCustom, Amount: 0.35}
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	var back Config
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if back.Exp[0].Curve != c.Exp[0].Curve || back.Normalize().Exp[0].Curve != c.Exp[0].Curve {
		t.Errorf("curve lost in the round trip: %+v", back.Exp[0].Curve)
	}
}

// expCC is the CC value the engine sends for a raw value on a fresh input.
func expCC(t *testing.T, cfg Config, raw int) int {
	t.Helper()
	e := NewEngine(cfg)
	out := e.Exp(0, raw, time.Unix(0, 0)).Msgs()
	if len(out) != 1 {
		t.Fatalf("raw %d sent %v", raw, out)
	}
	return int(out[0][2])
}

func TestEngineSendsTheCurvedValue(t *testing.T) {
	cfg := Default()
	cfg.Exp[0].Min, cfg.Exp[0].Max = 0, 60000
	for _, c := range []ExpCurve{{Kind: CurveLinear}, {Kind: CurveGentle}, {Kind: CurveFast}, {Kind: CurveS}, {Kind: CurveCustom, Amount: 0.35}} {
		cfg.Exp[0].Curve = c
		for _, raw := range []int{0, 6000, 15000, 30000, 45000, 54000, 60000} {
			want := int(math.Round(c.Apply(float64(raw)/60000) * 127))
			if got := expCC(t, cfg, raw); got != want {
				t.Errorf("%+v raw %d: CC %d, want %d", c, raw, got, want)
			}
		}
	}
	// Invert flips the travel before the curve: the toe end is the fine one then.
	cfg.Exp[0].Curve, cfg.Exp[0].Invert = ExpCurve{Kind: CurveGentle}, true
	if got, want := expCC(t, cfg, 45000), int(math.Round(ExpCurve{Kind: CurveGentle}.Apply(0.25)*127)); got != want {
		t.Errorf("inverted gentle: CC %d, want %d", got, want)
	}
}

// The hysteresis works on the curved value: on Gentle's flat heel end a resting pedal
// wobbling by a few raw units sends nothing new.
func TestCurvedHysteresis(t *testing.T) {
	cfg := Default()
	cfg.Exp[0].Curve = ExpCurve{Kind: CurveFast} // steep at the heel: the hardest case
	e := NewEngine(cfg)
	at := time.Unix(0, 0)
	first := e.Exp(0, 3000, at).Msgs()
	if len(first) != 1 {
		t.Fatalf("first value sent %v", first)
	}
	for i, raw := range []int{3010, 2990, 3020, 2985, 3000} {
		if out := e.Exp(0, raw, at.Add(time.Duration(i+1)*time.Millisecond)).Msgs(); len(out) != 0 {
			t.Fatalf("resting at %d flickered: %v", raw, out)
		}
	}
}
