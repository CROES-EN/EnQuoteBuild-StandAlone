param(
  [Parameter(Mandatory = $true)][string]$Operation,
  [Parameter(Mandatory = $true)][string]$WorkbookPath,
  [string]$Payload = "",
  [string]$SnapshotDirectory = [IO.Path]::GetTempPath()
)

$ErrorActionPreference = "Stop"
$tableName = "Table2"
$extraColumns = @(
  "When should the Enphase Care plan be canceled?",
  "Is a refund also being requested?",
  "Services completed",
  "Is the customer escalated?",
  "Customer email address",
  "Case number",
  'Add reason if the "Other" is selected',
  "EnQuote Requestor Department",
  "EnQuote Refund Type",
  "EnQuote Site Visit Completed",
  "EnQuote Leadership Approval Required",
  "EnQuote Leadership Approval Justification",
  "EnQuote Additional Notes",
  "EnQuote Store Team Notes",
  "EnQuote Escalation Notes",
  "EnQuote Refund Processed Date",
  "EnQuote Processor Name",
  "EnQuote Leadership Approver",
  "EnQuote Approval Date",
  "EnQuote Last Updated At",
  "EnQuote Sync Status"
)
$dateColumns = @(
  "Start time", "Completion time", "EnQuote Refund Processed Date",
  "EnQuote Approval Date", "EnQuote Last Updated At"
)

function Release-ComObject($object) {
  if ($null -ne $object -and [System.Runtime.InteropServices.Marshal]::IsComObject($object)) {
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($object)
  }
}

function Get-StreamHash($stream) {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $stream.Position = 0
    return [Convert]::ToBase64String($hasher.ComputeHash($stream))
  } finally {
    $hasher.Dispose()
    $stream.Position = 0
  }
}

function Get-RowCell($row, [int]$columnIndex) {
  $range = $null
  $cells = $null
  try {
    $range = $row.Range
    $cells = $range.Cells
    return $cells.Item(1, $columnIndex)
  } finally {
    Release-ComObject $cells
    Release-ComObject $range
  }
}

function Get-CellValue($cell, [string]$columnName) {
  $value = $cell.Value2
  if ($null -eq $value -or $value -eq "") { return $null }
  if ($dateColumns -contains $columnName -and $value -is [double]) {
    return [DateTime]::FromOADate($value).ToString("o")
  }
  return $value
}

function Set-CellValue($cell, [string]$columnName, $value) {
  if ($null -eq $value -or $value -eq "") {
    $cell.ClearContents()
    return
  }
  if ($dateColumns -contains $columnName) {
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$value, [ref]$parsed)) {
      throw "Invalid date value for $columnName."
    }
    $cell.Value = $parsed.LocalDateTime
    $cell.NumberFormat = "yyyy-mm-dd hh:mm"
    return
  }
  if ($value -is [ValueType] -and $value -isnot [bool]) {
    $cell.Value2 = [double]$value
  } elseif ($value -is [bool]) {
    $cell.Value2 = [string]$(if ($value) { "Yes" } else { "No" })
  } else {
    $cell.NumberFormat = "@"
    $cell.Value2 = [string]$value
  }
}

if (-not (Test-Path -LiteralPath $WorkbookPath -PathType Leaf)) {
  throw "The selected refund workbook does not exist."
}
if ([IO.Path]::GetExtension($WorkbookPath).ToLowerInvariant() -ne ".xlsx") {
  throw "The refund tracker must be an .xlsx workbook."
}

$data = $null
if ($Payload) {
  $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))
  $data = ConvertFrom-Json -InputObject $json
}

$excel = $null
$workbook = $null
$worksheet = $null
$table = $null
$listColumns = $null
$listRows = $null
$workingPath = Join-Path $SnapshotDirectory ("enquote-refund-" + [guid]::NewGuid().ToString() + ".xlsx")
$replacementPath = $null
$backupPath = $null
$originalHash = $null
$stage = "open"
try {
  if ($Operation -eq "write") {
    $accessCheck = $null
    try {
      $accessCheck = [IO.File]::Open($WorkbookPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch {
      throw "The tracker is locked or not writable. Close it in Excel, wait for OneDrive to finish syncing, and verify edit access before retrying."
    } finally {
      if ($accessCheck) { $accessCheck.Dispose() }
    }
  }
  $source = $null
  $snapshot = $null
  try {
    $source = [IO.File]::Open($WorkbookPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $originalHash = Get-StreamHash $source
    $snapshot = [IO.File]::Open($workingPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $source.CopyTo($snapshot)
  } finally {
    if ($snapshot) { $snapshot.Dispose() }
    if ($source) { $source.Dispose() }
  }
  if ($Operation -eq "write" -and $data.expectedHash -and $data.expectedHash -ne $originalHash) {
    throw "The shared tracker changed since it was read. Sync again before retrying; newer edits were not overwritten."
  }
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AutomationSecurity = 3
  $excel.ScreenUpdating = $false
  $workbooks = $excel.Workbooks
  try {
    $workbook = $workbooks.Open($workingPath, 0, ($Operation -eq "read"))
  } finally { Release-ComObject $workbooks }
  if ($Operation -eq "write" -and $workbook.ReadOnly) {
    throw "The workbook is read-only. Close it in Excel and verify that you have edit access."
  }

  $worksheets = $workbook.Worksheets
  try {
    for ($index = 1; $index -le $worksheets.Count; $index++) {
      $sheet = $worksheets.Item($index)
      $tables = $sheet.ListObjects
      try {
        $table = $tables.Item($tableName)
        $worksheet = $sheet
        break
      } catch {
        Release-ComObject $table
        $table = $null
      } finally { Release-ComObject $tables }
      Release-ComObject $sheet
    }
  } finally { Release-ComObject $worksheets }
  if ($null -eq $table) {
    throw "The workbook does not contain the $tableName table."
  }
  $listColumns = $table.ListColumns
  $listRows = $table.ListRows

  if ($Operation -eq "write") {
    $stage = "update"
    foreach ($columnName in $extraColumns) {
      $column = $null
      try { $column = $listColumns.Item($columnName) } catch {}
      if ($null -eq $column) {
        $column = $listColumns.Add()
        $column.Name = $columnName
      }
      Release-ComObject $column
    }
  } elseif ($Operation -ne "read") {
    throw "Unsupported workbook operation."
  }

  $headers = @()
  for ($columnIndex = 1; $columnIndex -le $listColumns.Count; $columnIndex++) {
    $column = $listColumns.Item($columnIndex)
    try { $headers += [string]$column.Name } finally { Release-ComObject $column }
  }

  if ($Operation -eq "write") {
    if ($null -eq $data -or $null -eq $data.rows) {
      throw "The workbook update payload is invalid."
    }
    $idColumn = $headers.IndexOf("ID") + 1
    if ($idColumn -lt 1) { throw "The refund table is missing its ID column." }
    if ($data.deleteIds) {
      for ($rowIndex = $listRows.Count; $rowIndex -ge 1; $rowIndex--) {
        $row = $listRows.Item($rowIndex)
        $cell = Get-RowCell $row $idColumn
        try {
          if (@($data.deleteIds) -contains ([string]$cell.Text).Trim()) { $row.Delete() }
        } finally {
          Release-ComObject $cell
          Release-ComObject $row
        }
      }
    }

    foreach ($record in $data.rows) {
      $responseId = [string]$record.ID
      if ([string]::IsNullOrWhiteSpace($responseId)) {
        throw "A workbook row is missing its EnQuote response ID."
      }
      $targetRow = $null
      for ($rowIndex = 1; $rowIndex -le $listRows.Count; $rowIndex++) {
        $row = $listRows.Item($rowIndex)
        $cell = Get-RowCell $row $idColumn
        if ([string]$cell.Text -eq $responseId) {
          $targetRow = $row
          Release-ComObject $cell
          break
        }
        Release-ComObject $cell
        Release-ComObject $row
      }
      if ($null -eq $targetRow) {
        $targetRow = $listRows.Add()
      }
      try {
        foreach ($name in $record.PSObject.Properties.Name) {
          $columnIndex = $headers.IndexOf([string]$name) + 1
          if ($columnIndex -lt 1) { continue }
          $cell = Get-RowCell $targetRow $columnIndex
          try { Set-CellValue $cell ([string]$name) $record.$name }
          finally { Release-ComObject $cell }
        }
      } finally { Release-ComObject $targetRow }
    }
    $stage = "save"
    $workbook.Save()
  }

  $rows = @()
  for ($rowIndex = 1; $rowIndex -le $listRows.Count; $rowIndex++) {
    $row = $listRows.Item($rowIndex)
    $values = [ordered]@{}
    try {
      for ($columnIndex = 1; $columnIndex -le $headers.Count; $columnIndex++) {
        $cell = Get-RowCell $row $columnIndex
        try { $values[$headers[$columnIndex - 1]] = Get-CellValue $cell $headers[$columnIndex - 1] }
        finally { Release-ComObject $cell }
      }
      $rows += [pscustomobject]$values
    } finally { Release-ComObject $row }
  }

  $result = [pscustomobject]@{
    ok = $true
    tableName = $table.Name
    worksheetName = $worksheet.Name
    headers = $headers
    rows = $rows
    sourceHash = $originalHash
  }
  $serializedResult = ConvertTo-Json -InputObject $result -Depth 10 -Compress
  Release-ComObject $listRows
  $listRows = $null
  Release-ComObject $listColumns
  $listColumns = $null
  Release-ComObject $table
  $table = $null
  Release-ComObject $worksheet
  $worksheet = $null
  $workbook.Close($false)
  Release-ComObject $workbook
  $workbook = $null

  if ($Operation -eq "write") {
    $stage = "publish"
    $suffix = ".enquote-" + [guid]::NewGuid().ToString()
    $replacementPath = $WorkbookPath + $suffix + ".tmp"
    $backupPath = $WorkbookPath + $suffix + ".bak"
    [IO.File]::Copy($workingPath, $replacementPath, $false)
    $publishLock = $null
    try {
      $publishLock = [IO.File]::Open($WorkbookPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Delete)
      if ((Get-StreamHash $publishLock) -ne $originalHash) {
        throw "The shared tracker changed while Excel was processing. Sync again before retrying; newer edits were not overwritten."
      }
      # Same-directory replacement is atomic; the open handle denies other local reads/writes.
      [IO.File]::Replace($replacementPath, $WorkbookPath, $backupPath)
    } finally {
      if ($publishLock) { $publishLock.Dispose() }
    }
  }
} catch {
  throw "Refund workbook $Operation failed during ${stage}: $($_.Exception.Message)"
} finally {
  Release-ComObject $listRows
  Release-ComObject $listColumns
  Release-ComObject $table
  Release-ComObject $worksheet
  if ($workbook) {
    $workbook.Close($false)
    Release-ComObject $workbook
  }
  if ($excel) {
    $excel.Quit()
    Release-ComObject $excel
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  foreach ($temporaryPath in @($workingPath, $replacementPath, $backupPath)) {
    if ($temporaryPath -and [IO.File]::Exists($temporaryPath)) {
      [IO.File]::Delete($temporaryPath)
    }
  }
  $serializedResult
}
