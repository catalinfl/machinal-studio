package mcpserver

func summarizeProject(output Output) Output {
	project, ok := output.Data.(map[string]any)
	if !ok {
		return output
	}
	summary := make(map[string]any)
	for _, key := range []string{"id", "name", "version", "sessionId", "createdAt", "updatedAt"} {
		if value, exists := project[key]; exists {
			summary[key] = value
		}
	}
	state, _ := project["state"].(map[string]any)
	timeline, _ := state["timeline"].(map[string]any)
	channels, _ := timeline["channels"].([]any)
	texts, _ := timeline["textItems"].([]any)
	media, _ := state["media"].([]any)
	clips := 0
	for _, channel := range channels {
		track, _ := channel.(map[string]any)
		items, _ := track["clips"].([]any)
		clips += len(items)
	}
	summary["savedTimeline"] = map[string]any{"present": len(channels) > 0 || len(texts) > 0,
		"tracks": len(channels), "clips": clips, "texts": len(texts), "media": len(media),
		"schemaVersion": state["schemaVersion"], "preparedCompositionId": state["preparedCompositionId"]}
	presentation, _ := project["presentation"].(map[string]any)
	for _, name := range []string{"prepared", "lastRender"} {
		entry, ok := presentation[name].(map[string]any)
		if !ok {
			continue
		}
		saved := make(map[string]any)
		for _, key := range []string{"jobId", "filename", "updatedAt", "compositionId"} {
			if value, exists := entry[key]; exists {
				saved[key] = value
			}
		}
		plan, _ := entry["composition"].(map[string]any)
		for _, key := range []string{"id", "duration", "output", "documentRevision"} {
			if value, exists := plan[key]; exists {
				saved[key] = value
			}
		}
		summary[name] = saved
	}
	summary["detail"] = "summary"
	summary["fullResultHint"] = "Use fullResult=true before editing or save_project. This summary is not complete editor state."
	output.Data = summary
	return output
}
