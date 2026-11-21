package document

type VideoFit string

const (
	VideoFitContain VideoFit = "contain"
	VideoFitCover   VideoFit = "cover"
)

func (fit VideoFit) Valid() bool {
	return fit == "" || fit == VideoFitContain || fit == VideoFitCover
}
