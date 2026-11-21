package compiler

import (
	"fmt"
	"slices"

	"ffmpeg-go-server/editengine/document"
)

// Duration buckets bound the search while exact microseconds are retained for
// final verification. Keeping the last candidate in the key preserves overlap feasibility.
const montageDurationBucket document.Time = 100_000
const maxMontageStates = 8192

type montageSelection struct {
	indices  []int
	duration document.Time
	score    int
}

func (s *compilation) selectMontageMoments(moments []montageMoment, m document.Montage) []montageMoment {
	states := []montageSelection{{}}
	for index, moment := range moments {
		next := slices.Clone(states)
		for _, state := range states {
			overlap := document.Time(0)
			if len(state.indices) > 0 {
				var fits bool
				overlap, fits = s.montageOverlap(moments[state.indices[len(state.indices)-1]], moment, m.Between)
				if !fits {
					continue
				}
			}
			duration := state.duration + moment.end - moment.start - overlap
			if duration > m.TargetDuration+m.Tolerance {
				continue
			}
			next = append(next, montageSelection{
				indices: append(slices.Clone(state.indices), index), duration: duration,
				score: state.score + moment.rangeSpec.Score - 3,
			})
		}
		states = pruneMontageStates(next, m.TargetDuration)
	}
	var best *montageSelection
	for index := range states {
		state := &states[index]
		if len(state.indices) == 0 || absTime(state.duration-m.TargetDuration) > m.Tolerance {
			continue
		}
		if best == nil || state.score > best.score || state.score == best.score && absTime(state.duration-m.TargetDuration) < absTime(best.duration-m.TargetDuration) {
			best = state
		}
	}
	if best == nil {
		nearest := document.Time(0)
		for _, state := range states {
			if len(state.indices) > 0 && state.duration > nearest {
				nearest = state.duration
			}
		}
		s.fail("montage.candidates", "duration_unreachable", fmt.Sprintf("analyzed moments cannot produce %.3gs ± %.3gs with complete ranges and the requested transitions; closest available edit is at most %.3gs", m.TargetDuration.Seconds(), m.Tolerance.Seconds(), nearest.Seconds()))
		return nil
	}
	selected := make([]montageMoment, 0, len(best.indices))
	for _, index := range best.indices {
		selected = append(selected, moments[index])
	}
	return selected
}

func pruneMontageStates(states []montageSelection, target document.Time) []montageSelection {
	type key struct {
		last   int
		bucket document.Time
	}
	positions := make(map[key]int)
	kept := make([]montageSelection, 0, min(len(states), maxMontageStates))
	for _, state := range states {
		last := -1
		if len(state.indices) > 0 {
			last = state.indices[len(state.indices)-1]
		}
		k := key{last, state.duration / montageDurationBucket}
		if index, ok := positions[k]; ok {
			if state.score > kept[index].score || state.score == kept[index].score && absTime(state.duration-target) < absTime(kept[index].duration-target) {
				kept[index] = state
			}
			continue
		}
		positions[k] = len(kept)
		kept = append(kept, state)
	}
	if len(kept) <= maxMontageStates {
		return kept
	}
	slices.SortStableFunc(kept, func(a, b montageSelection) int {
		return timeCompare(absTime(a.duration-target), absTime(b.duration-target))
	})
	// Preserve shorter partial selections as well as near-target ones.
	result := slices.Clone(kept[:maxMontageStates/2])
	step := float64(len(kept)-maxMontageStates/2) / float64(maxMontageStates/2)
	for i := 0; i < maxMontageStates/2; i++ {
		result = append(result, kept[maxMontageStates/2+int(float64(i)*step)])
	}
	return result
}
