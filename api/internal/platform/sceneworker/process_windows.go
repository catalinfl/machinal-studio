package sceneworker

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

func configureProcess(cmd *exec.Cmd) {}

func stopProcess(cmd *exec.Cmd, done <-chan struct{}) {
	select {
	case <-done:
		return
	default:
	}
	// Kill only this worker's tree, including any esbuild/browser children.
	tool := filepath.Join(os.Getenv("SystemRoot"), "System32", "taskkill.exe")
	_ = exec.Command(tool, "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F").Run()
	_ = cmd.Process.Kill()
	<-done
}
