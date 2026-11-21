package projects

import (
	"os"
	"path/filepath"
)

func openSnapshotFile(path string) (*os.File, error) {
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return root.Open(filepath.Base(path))
}

func publishJSONFile(temporary, path string) error {
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer root.Close()
	// Root.Rename supports replacing an open snapshot on Windows as well as Unix.
	return root.Rename(filepath.Base(temporary), filepath.Base(path))
}
