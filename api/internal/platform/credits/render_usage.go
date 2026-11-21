package credits

type RenderUsage struct {
	Category         string  `json:"category"`
	DurationSeconds  float64 `json:"durationSeconds"`
	CreditsPerMinute string  `json:"creditsPerMinute"`
	BilledCredits    float64 `json:"billedCredits"`
	Rounding         string  `json:"rounding"`
}

func (pricing Pricing) renderUsage(category string, seconds float64, units int64) *RenderUsage {
	return &RenderUsage{Category: category, DurationSeconds: seconds, CreditsPerMinute: pricing.RenderPerMinute,
		BilledCredits: number(units), Rounding: "floor-whole-credits-per-render"}
}

func (reservation *Reservation) recordRenderUsage(event string, usage *RenderUsage) {
	if usage == nil {
		return
	}
	if reservation.RenderUsage == nil {
		reservation.RenderUsage = make(map[string]RenderUsage)
	}
	reservation.RenderUsage[event] = *usage
}
