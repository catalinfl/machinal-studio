package credits

import (
	"math"
	"testing"
)

func TestProviderCostRoundsDownToWholeCredits(t *testing.T) {
	pricing := Pricing{USDPerCredit: "0.01", RenderPerMinute: "2"}
	for _, test := range []struct {
		cost  string
		units int64
	}{
		{"0.00014", 0},
		{"1e-9", 0},
		{"0.00000000001", 0},
		{"0.000000", 0},
		{"0.001999999999", 0},
		{"0.002", UnitsPerCredit},
		{"0.003", UnitsPerCredit},
		{"0.003999999999", UnitsPerCredit},
		{"0.004", 2 * UnitsPerCredit},
		{"0.005999999999", 2 * UnitsPerCredit},
		{"0.006", 3 * UnitsPerCredit},
		{"0.009999999999", 4 * UnitsPerCredit},
		{"0.01", 5 * UnitsPerCredit},
		{"0.02000015", 10 * UnitsPerCredit},
		{"0.024", 12 * UnitsPerCredit},
		{"0.029999999999", 14 * UnitsPerCredit},
		{"0.03", 15 * UnitsPerCredit},
		{"2", 1000 * UnitsPerCredit},
	} {
		got, err := pricing.AIUnits(test.cost)
		if err != nil || got != test.units {
			t.Errorf("cost %s: %d, %v", test.cost, got, err)
		}
	}
	for _, cost := range []string{"-1", "NaN", "Infinity", "", "9999999999999999999999999"} {
		if _, err := pricing.AIUnits(cost); err == nil {
			t.Errorf("accepted %q", cost)
		}
	}
}

func TestAIUsageUsesTwentyPercentOfCreditFaceValue(t *testing.T) {
	for _, test := range []struct {
		price string
		units int64
	}{
		{"0.01", 1000 * UnitsPerCredit},
		{"0.10", 100 * UnitsPerCredit},
		{"1", 10 * UnitsPerCredit},
	} {
		pricing := Pricing{USDPerCredit: test.price, RenderPerMinute: "2"}
		units, err := pricing.AIUnits("2")
		if err != nil || units != test.units {
			t.Errorf("$2 upstream at $%s per credit: %d, %v", test.price, units, err)
		}
	}
}

func TestRenderCostRoundsDownToWholeCredits(t *testing.T) {
	pricing := Pricing{USDPerCredit: "0.01", RenderPerMinute: "2"}
	for _, test := range []struct {
		seconds float64
		units   int64
	}{
		{12, 0},
		{30, UnitsPerCredit},
		{60.00045, 2 * UnitsPerCredit},
		{72, 2 * UnitsPerCredit},
		{89.999999, 2 * UnitsPerCredit},
		{90, 3 * UnitsPerCredit},
	} {
		got, err := pricing.RenderUnits(test.seconds)
		if err != nil || got != test.units {
			t.Errorf("duration %v: %d, %v", test.seconds, got, err)
		}
	}
	for _, seconds := range []float64{-1, 0, math.NaN(), math.Inf(1), 86401} {
		if _, err := pricing.RenderUnits(seconds); err == nil {
			t.Errorf("accepted duration %v", seconds)
		}
	}
}

func TestMissingRatesFailClosed(t *testing.T) {
	if err := (Pricing{}).Validate(); err == nil {
		t.Fatal("missing pricing accepted")
	}
	if err := (Pricing{USDPerCredit: "0", RenderPerMinute: "1"}).Validate(); err == nil {
		t.Fatal("zero rate accepted")
	}
}
