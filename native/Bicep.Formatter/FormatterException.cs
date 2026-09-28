sealed class FormatterException(
    string code,
    string message,
    int? line = null,
    int? column = null,
    string? diagnosticCode = null) : Exception(message)
{
    public string Code { get; } = code;
    public int? Line { get; } = line;
    public int? Column { get; } = column;
    public string? DiagnosticCode { get; } = diagnosticCode;
}
