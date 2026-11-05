package mapping

import (
	"time"

	"flintstep/internal/sparkx"
)

// EXPRESSION TRIGGERS: a switch faked from the pedal's position.
//
// The Spark Control X reads one analogue value per expression jack, so the toe switch
// many expression pedals have cannot reach it. Instead the engine watches the travel
// the CC already sends (calibrated, inverted, through the response curve) and fires an
// Action when it crosses a threshold. A threshold is therefore a percent of the value
// the DAW receives: 50 % is CC 64 whatever the curve.
//   - engage: press on rising to Threshold, release once back under it (less the
//     hysteresis) for OffDelayMS. A quick touch on the heel does not switch it off.
//   - toe: press on reaching Threshold, release on falling under it less the
//     hysteresis. A CC toggle flips on each push, like a real toe switch.
//
// The hysteresis (TriggerHysteresis percent) means noise at the boundary cannot
// chatter: once pressed, the pedal has to come clearly back before it lets go.

// trigger is one input's trigger state.
type trigger struct {
	held   bool      // the press half went out, its release has not
	active Action    // what the press sent, so the release ends the same thing
	due    time.Time // engage: release at due; zero = no off delay running
	on     bool      // a CC toggle action's state
}

// trigKey is what makes a held trigger let go when it changes: the input switched off,
// another mode, another action. A new threshold or off delay is only re-read on the
// next value.
func trigKey(x ExpConfig) [3]any {
	return [3]any{x.Enabled, x.Trigger.Mode, x.Trigger.Action}
}

// level is a percent of the travel in the units Exp scales to (0..ExpRawMax), times
// 100 so the comparison is exact.
func level(pct int) int { return pct * ExpRawMax }

// trigger runs input n's trigger on its curved travel (0..ExpRawMax, inverted as the CC
// is). It returns the press half to send before the CC and the release half to send
// after it.
func (e *Engine) trigger(n, scaled int, at time.Time) (press, release Outs) {
	tr := e.cfg.Exp[n].Trigger
	t := &e.trig[n]
	if tr.Mode != TriggerEngage && tr.Mode != TriggerToe {
		return nil, nil
	}
	x := scaled * 100
	// Under offAt lets go. A threshold under the hysteresis would put that below the
	// heel, so there the heel itself (0) lets go.
	offAt := max(level(tr.Threshold-TriggerHysteresis), 1)
	switch {
	case !t.held && x >= level(tr.Threshold):
		t.held, t.active, t.due = true, tr.Action, time.Time{}
		return tag(e.pressHalf(tr.Action, &t.on), Origin{Source: SrcTrigger, Index: n}), nil
	case t.held && tr.Mode == TriggerEngage && x >= level(tr.Threshold):
		t.due = time.Time{} // back up inside the off delay: stay on
	case t.held && x < offAt:
		if tr.Mode == TriggerEngage && tr.OffDelayMS > 0 {
			if t.due.IsZero() {
				t.due = at.Add(time.Duration(tr.OffDelayMS) * time.Millisecond)
			}
			return nil, nil
		}
		return nil, e.letGo(n)
	}
	return nil, nil
}

// letGo ends input n's held trigger: the release half of what it pressed.
func (e *Engine) letGo(n int) Outs {
	t := &e.trig[n]
	if !t.held {
		return nil
	}
	a := t.active
	t.held, t.active, t.due = false, Action{}, time.Time{}
	return tag(e.releaseHalf(a), Origin{Source: SrcTrigger, Index: n})
}

// tickTriggers fires the off delays due by at.
func (e *Engine) tickTriggers(at time.Time) Outs {
	var out Outs
	for n := range e.trig {
		t := e.trig[n]
		if t.held && !t.due.IsZero() && !at.Before(t.due) {
			out = append(out, e.letGo(n)...)
		}
	}
	return out
}

func (e *Engine) triggerPending() bool {
	for _, t := range e.trig {
		if t.held && !t.due.IsZero() {
			return true
		}
	}
	return false
}

// ExpRelease is input n losing its cable: its held trigger lets go (the release half
// is returned) and its next value is sent whatever it is. A toggle keeps its state.
func (e *Engine) ExpRelease(n int) Outs {
	if n < 0 || n >= sparkx.ExpInputs {
		return nil
	}
	e.exp.Reset(n)
	return released(e.letGo(n))
}

// ExpTriggers says which inputs' triggers are engaged now, for the UI's lamp: held for
// a momentary or note action, on for a CC toggle (which stays on after the toe comes
// back, like a switch's lamp).
func (e *Engine) ExpTriggers() [sparkx.ExpInputs]bool {
	var out [sparkx.ExpInputs]bool
	for n, t := range e.trig {
		tr := e.cfg.Exp[n].Trigger
		if tr.Mode != TriggerEngage && tr.Mode != TriggerToe {
			continue
		}
		if isToggle(tr.Action) {
			out[n] = t.on
		} else {
			out[n] = t.held
		}
	}
	return out
}
