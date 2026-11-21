package document

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"time"
)

// Time uses integer microseconds; JSON adapters expose seconds, YAML also accepts s/ms.
type Time int64

const (
	Second  Time = 1_000_000
	MaxTime      = 24 * 60 * 60 * Second
)

func Seconds(value float64) Time { return Time(math.Round(value * float64(Second))) }
func (t Time) Seconds() float64  { return float64(t) / float64(Second) }
func (t Time) MarshalJSON() ([]byte, error) {
	return []byte(strconv.FormatFloat(t.Seconds(), 'f', -1, 64)), nil
}

func (t *Time) UnmarshalJSON(data []byte) error {
	var seconds float64
	if bytes.Equal(data, []byte("null")) {
		return fmt.Errorf("time cannot be null")
	}
	if len(data) > 0 && data[0] == '"' {
		var value string
		if err := json.Unmarshal(data, &value); err != nil {
			return err
		}
		duration, err := time.ParseDuration(value)
		if err != nil {
			return fmt.Errorf("time requires seconds or milliseconds: %w", err)
		}
		seconds = duration.Seconds()
	} else if err := json.Unmarshal(data, &seconds); err != nil {
		return fmt.Errorf("time requires seconds or milliseconds: %w", err)
	}
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) || math.Abs(seconds) > MaxTime.Seconds() {
		return fmt.Errorf("time must be within 24 hours")
	}
	*t = Seconds(seconds)
	return nil
}
