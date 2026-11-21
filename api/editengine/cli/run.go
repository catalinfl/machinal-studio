package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/render/ffmpeg"
	"ffmpeg-go-server/editengine/render/textprepare"
	"ffmpeg-go-server/internal/core/editor/compositions"
)

type options struct {
	document string
	stdin    bool
	assets   string
	bindings string
	root     string
	output   string
	render   bool
	hydrate  bool
}

func parseOptions(args []string, stderr io.Writer) (options, error) {
	var option options
	if len(args) > 0 && (args[0] == "render" || args[0] == "compile") {
		option.render, option.hydrate = args[0] == "render", true
		args = args[1:]
		if len(args) > 0 && args[0] != "" && args[0][0] != '-' {
			option.document, args = args[0], args[1:]
		}
	}
	flags := flag.NewFlagSet("edit", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.Usage = func() {
		fmt.Fprintln(stderr, "Usage: edit render recipe.yaml --root /media [--output result.mp4]\n       edit compile recipe.yaml --root /media")
		flags.PrintDefaults()
	}
	flags.StringVar(&option.document, "document", option.document, "YAML/JSON recipe or saved project")
	flags.BoolVar(&option.stdin, "stdin", false, "read a project from stdin")
	flags.StringVar(&option.assets, "assets", "", "optional JSON asset manifest")
	flags.StringVar(&option.bindings, "bindings", "", "optional JSON slot bindings")
	flags.StringVar(&option.root, "root", ".", "directory containing source media")
	flags.StringVar(&option.output, "output", "", "output filename; must not already exist")
	flags.BoolVar(&option.render, "render", option.render, "generate pending recipe actions and render")
	if err := flags.Parse(args); err != nil {
		return option, err
	}
	if flags.NArg() > 0 {
		return option, fmt.Errorf("unexpected argument %q; use edit render recipe.yaml --root /path/to/media", flags.Arg(0))
	}
	if option.stdin == (option.document != "") {
		return option, fmt.Errorf("choose a recipe path or --stdin, not both")
	}
	return option, nil
}

func Run(args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	option, err := parseOptions(args, stderr)
	if errors.Is(err, flag.ErrHelp) {
		return nil
	}
	if err != nil {
		return err
	}
	input, err := readInput(option, stdin)
	if err != nil {
		return err
	}
	root, err := filepath.Abs(option.root)
	if err != nil {
		return fmt.Errorf("resolve media directory: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	result, err := compileInput(ctx, input, option, root)
	if err != nil {
		return err
	}
	return writeResult(ctx, result, option, root, stdout)
}

func compileInput(ctx context.Context, input compiler.Input, option options, root string) (composition.Result, error) {
	var err error
	if option.hydrate || option.render {
		input, err = compositions.ResolveProjectAssets(ctx, input, root, "")
		if err != nil {
			return composition.Result{}, err
		}
	}
	if option.render {
		return compositions.CompileGenerated(ctx, input, root, "")
	}
	return compiler.New().Compile(input), nil
}

func writeResult(ctx context.Context, result composition.Result, option options, root string, stdout io.Writer) error {
	if !option.render || result.Composition == nil {
		if err := json.NewEncoder(stdout).Encode(result); err != nil {
			return fmt.Errorf("write compilation: %w", err)
		}
		if result.Composition == nil {
			return fmt.Errorf("compilation has diagnostics or unmet requirements")
		}
		return nil
	}
	return renderResult(ctx, result, option, root, stdout)
}

func renderResult(ctx context.Context, result composition.Result, option options, root string, stdout io.Writer) error {
	if err := textprepare.Prepare(ctx, result.Composition); err != nil {
		return err
	}
	output, err := (ffmpeg.Renderer{Root: root}).Render(ctx, *result.Composition)
	if err != nil {
		return fmt.Errorf("render composition: %w", err)
	}
	if option.output != "" {
		if err := copyOutput(output.Path, option.output); err != nil {
			return err
		}
		output.Path, err = filepath.Abs(option.output)
		if err != nil {
			return err
		}
		output.Filename = filepath.Base(output.Path)
	}
	return json.NewEncoder(stdout).Encode(output)
}

func readInput(option options, stdin io.Reader) (compiler.Input, error) {
	var reader io.Reader = stdin
	if !option.stdin {
		file, err := os.Open(option.document)
		if err != nil {
			return compiler.Input{}, fmt.Errorf("open recipe: %w", err)
		}
		defer file.Close()
		reader = file
	}
	data, err := io.ReadAll(io.LimitReader(reader, document.MaxProjectBytes+1))
	if err != nil {
		return compiler.Input{}, fmt.Errorf("read recipe: %w", err)
	}
	input, _, err := compositions.ParseProject(data)
	if err != nil {
		return input, err
	}
	for _, field := range []struct {
		path   string
		target any
	}{{option.assets, &input.Assets}, {option.bindings, &input.Bindings}} {
		if field.path == "" {
			continue
		}
		file, err := os.Open(field.path)
		if err != nil {
			return input, fmt.Errorf("open manifest: %w", err)
		}
		data, err := io.ReadAll(io.LimitReader(file, document.MaxProjectBytes+1))
		closeErr := file.Close()
		if err != nil {
			return input, fmt.Errorf("read manifest: %w", err)
		}
		if closeErr != nil {
			return input, fmt.Errorf("close manifest: %w", closeErr)
		}
		if len(data) > document.MaxProjectBytes {
			return input, fmt.Errorf("manifest is too large")
		}
		if err := document.DecodeJSON(data, field.target); err != nil {
			return input, fmt.Errorf("decode manifest: %w", err)
		}
	}
	return input, nil
}

func copyOutput(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open rendered video: %w", err)
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("create output (existing files are never overwritten): %w", err)
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return fmt.Errorf("save output: %w", copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close output: %w", closeErr)
	}
	return nil
}
