$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'machinal - Connect your account'
$form.ClientSize = New-Object System.Drawing.Size(590, 290)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$intro = New-Object System.Windows.Forms.Label
$intro.Text = "One machinal API key is enough. Reuse the saved key, or enter a replacement.`r`nThe replacement is checked before saving. Never paste a key into chat."
$intro.SetBounds(20, 20, 550, 42)
$form.Controls.Add($intro)

$endpoint = New-Object System.Windows.Forms.Label
$endpoint.Text = "API: $env:MACHINAL_AUTH_ENDPOINT"
$endpoint.SetBounds(20, 70, 550, 22)
$form.Controls.Add($endpoint)

$link = New-Object System.Windows.Forms.LinkLabel
$link.Text = "Need a new key? Open $env:MACHINAL_AUTH_KEYS_URL"
$link.SetBounds(20, 100, 550, 24)
$link.Add_LinkClicked({ Start-Process -FilePath $env:MACHINAL_AUTH_KEYS_URL })
$form.Controls.Add($link)

$label = New-Object System.Windows.Forms.Label
$label.Text = 'New or existing machinal API key'
$label.SetBounds(20, 135, 550, 22)
$form.Controls.Add($label)

$key = New-Object System.Windows.Forms.TextBox
$key.UseSystemPasswordChar = $true
$key.SetBounds(20, 160, 550, 26)
$form.Controls.Add($key)

$remember = New-Object System.Windows.Forms.CheckBox
$remember.Text = 'Replace the saved key on this device after successful verification'
$remember.Checked = $false
$remember.SetBounds(20, 198, 550, 24)
$form.Controls.Add($remember)

$reuse = New-Object System.Windows.Forms.Button
$reuse.Text = 'Use saved key'
$reuse.SetBounds(20, 240, 135, 30)
$reuse.DialogResult = [System.Windows.Forms.DialogResult]::Retry
$form.Controls.Add($reuse)

$submit = New-Object System.Windows.Forms.Button
$submit.Text = 'Verify and connect'
$submit.SetBounds(285, 240, 150, 30)
$submit.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $submit
$form.Controls.Add($submit)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.SetBounds(445, 240, 125, 30)
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancel
$form.Controls.Add($cancel)

$result = $form.ShowDialog()
$answer = if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    @{ action = 'replace'; key = $key.Text; remember = [bool]$remember.Checked }
} elseif ($result -eq [System.Windows.Forms.DialogResult]::Retry) {
    @{ action = 'reuse' }
} else {
    $null
}
$key.Clear()
$form.Dispose()
[Console]::Write((ConvertTo-Json -InputObject $answer -Compress))
