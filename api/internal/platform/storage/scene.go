package storage

import "regexp"

var sceneSourceFilename = regexp.MustCompile(`^ai_scene_[a-f0-9]{32}_\d{2}\.scene\.json$`)

func IsSceneSource(name string) bool {
	return sceneSourceFilename.MatchString(name)
}
