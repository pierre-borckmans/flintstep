package bridge

import (
	"bytes"
	"sync"
	"testing"
	"time"

	"sparkbridge/internal/mapping"
	"sparkbridge/internal/sparkx"
)

// gate makes the first call through it wait until open is closed, and says when that
// call has arrived.
type gate struct {
	once    sync.Once
	arrived chan struct{}
	open    chan struct{}
}

func newGate() *gate { return &gate{arrived: make(chan struct{}), open: make(chan struct{})} }

func (g *gate) pass() {
	first := false
	g.once.Do(func() { first = true })
	if first {
		close(g.arrived)
		<-g.open
	}
}

type gatedOut struct {
	fakeOut
	g *gate
}

func (o *gatedOut) Send(m []byte) error {
	o.g.pass()
	return o.fakeOut.Send(m)
}

type gatedPedal struct {
	fakePedal
	g *gate
}

func (p *gatedPedal) SetLamps(l [sparkx.Switches]sparkx.Colour) {
	p.g.pass()
	p.fakePedal.SetLamps(l)
}

// A long press fired by the tick loop and the release that ends it come from two
// goroutines. Whatever the scheduling, the DAW must see the "on" before the "off", or
// the CC is left stuck on.
func TestLongPressAndReleaseLeaveInOrder(t *testing.T) {
	cfg := mapping.Default()
	cfg.Switches[2].Long = mapping.Action{Kind: mapping.KindCC, Channel: 1, Number: 90, Value: 127}
	c := &clock{t: time.Unix(1_000_000, 0)}
	out := &gatedOut{g: newGate()}
	b := New(cfg, out, Options{Now: c.now})
	defer b.Close()
	b.SetPedal(&fakePedal{})
	h := b.Handlers()

	h.Switch(sparkx.Edge{Switch: 2, Down: true})
	c.t = c.t.Add(time.Second)

	ticked := make(chan struct{})
	go func() { b.Tick(); close(ticked) }() // fires CC 90 = 127, held up in Send
	<-out.g.arrived
	released := make(chan struct{})
	go func() { h.Switch(sparkx.Edge{Switch: 2}); close(released) }() // CC 90 = 0
	time.Sleep(30 * time.Millisecond)
	close(out.g.open)
	<-ticked
	<-released

	sent := out.all()
	if len(sent) != 2 || !bytes.Equal(sent[0], []byte{0xB0, 90, 127}) || !bytes.Equal(sent[1], []byte{0xB0, 90, 0}) {
		t.Fatalf("sent % x, want CC 90 = 127 then CC 90 = 0", sent)
	}
}

// A lamp update computed earlier must not land after one computed later: the pedal
// would keep showing the stale colour, and the bridge, thinking it sent the new one,
// never corrects it.
func TestLampUpdatesLeaveInOrder(t *testing.T) {
	cfg := mapping.Default()
	b := New(cfg, &fakeOut{}, Options{})
	defer b.Close()
	p := &gatedPedal{g: newGate()}
	b.SetPedal(p)
	h := b.Handlers()

	pressed := make(chan struct{})
	go func() { h.Switch(sparkx.Edge{Switch: 0, Down: true}); close(pressed) }() // lamp I lit, held up
	<-p.g.arrived
	recoloured := cfg
	recoloured.Switches[0].Colour = sparkx.Colour{R: 1, G: 2, B: 3}
	applied := make(chan struct{})
	go func() {
		if _, err := b.Apply(recoloured); err != nil {
			t.Error(err)
		}
		close(applied)
	}()
	time.Sleep(30 * time.Millisecond)
	close(p.g.open)
	<-pressed
	<-applied

	lamps, _ := p.last()
	if lamps[0] != (sparkx.Colour{R: 1, G: 2, B: 3}) {
		t.Fatalf("lamp I shows %+v after the colour changed, want the new colour", lamps[0])
	}
}
