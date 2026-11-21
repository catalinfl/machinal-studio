package document

import "encoding/json"

func (c *Clip) UnmarshalJSON(data []byte) error {
	type plain Clip
	value := plain{PlaybackRate: 1, Volume: 100, Opacity: 1, Transform: IdentityTransform(), TransformKeyframes: []Keyframe{}}
	if err := DecodeJSON(data, &value); err != nil {
		return err
	}
	*c = Clip(value)
	return nil
}

func (t *Transform) UnmarshalJSON(data []byte) error {
	type plain Transform
	value := plain(IdentityTransform())
	if err := DecodeJSON(data, &value); err != nil {
		return err
	}
	*t = Transform(value)
	return nil
}

func (t *TextItem) UnmarshalJSON(data []byte) error {
	type plain TextItem
	value := plain{TextStyle: DefaultTextStyle(), Words: []Word{}}
	if err := DecodeJSON(data, &value); err != nil {
		return err
	}
	*t = TextItem(value)
	return json.Unmarshal(data, &t.Explicit)
}
