package render

func channelNeedsBaseMask(channel channel) bool {
	for _, clip := range channel.Clips {
		if hasClipCompositing(clip) || clip.sceneTransparent {
			return true
		}
	}
	return false
}
