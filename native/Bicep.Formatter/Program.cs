using System.Text.Json;
using Bicep.Core;
using Bicep.Core.PrettyPrintV2;
using Bicep.Core.SourceGraph;
using Bicep.IO.Abstraction;

Console.InputEncoding = new System.Text.UTF8Encoding(false);
Console.OutputEncoding = new System.Text.UTF8Encoding(false);
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
const int protocolVersion = 2;
var compiler = BicepCompiler.Create();
while (await Console.In.ReadLineAsync() is { } line)
{
    try
    {
        var request = JsonSerializer.Deserialize<Request>(line, json)
            ?? throw new FormatException("Expected a formatter request.");
        if (request.ProtocolVersion != protocolVersion)
        {
            throw new FormatterException("BICEP_BRIDGE_VERSION_MISMATCH",
                $"The Bicep formatter and native bridge use incompatible protocols (formatter: {request.ProtocolVersion?.ToString() ?? "legacy"}, bridge: {protocolVersion}). Run Developer: Reload Window in VS Code. If it persists, reinstall the extension or run npm run build:extension in a source checkout; keep the JavaScript and bridge from the same build.");
        }
        if (request.Text is null)
        {
            throw new FormatterException("BICEP_INVALID_REQUEST", "The request must include source text.");
        }
        var uri = IOUri.FromFilePath(Path.GetFullPath(request.Filepath ?? "main.bicep"));
        FormatOptions settings;
        try
        {
            if (request.Options.ValueKind is not (JsonValueKind.Object or JsonValueKind.Undefined))
                throw new FormatException("Formatter options must be a JSON object.");
            settings = (request.Options.ValueKind == JsonValueKind.Object
                ? request.Options.Deserialize<FormatOptions>(json) ?? new()
                : new FormatOptions()).ResolveLayout();
            settings.Validate();
        }
        catch (JsonException exception)
        {
            var option = exception.Path?.StartsWith("$.") == true ? exception.Path[2..].Split('[')[0] : "options";
            var hint = option is "bicepDeclarationOrder" or "bicepResourcePropertyOrder" or "bicepModulePropertyOrder" or "bicepDecoratorOrder"
                ? "Use a JSON array of names, not a comma-separated string; for example [\"name\", \"*\", \"properties\"] for property ordering."
                : "Check the option's type and allowed values in CONFIGURATION.md.";
            throw new FormatterException("BICEP_INVALID_CONFIGURATION", $"Invalid {option}. {hint}");
        }
        catch (FormatException exception)
        {
            throw new FormatterException("BICEP_INVALID_CONFIGURATION", exception.Message);
        }
        var parameters = request.Parser == "bicepparam" ||
            request.Parser is null && uri.ToString().EndsWith(".bicepparam", StringComparison.OrdinalIgnoreCase);
        var result = new Engine(compiler, uri, settings, parameters).Format(request.Text);
        Console.WriteLine(JsonSerializer.Serialize(new { protocolVersion, text = result }, json));
    }
    catch (Exception exception)
    {
        var failure = exception as FormatterException;
        var code = failure?.Code ?? exception switch
        {
            JsonException => "BICEP_INVALID_REQUEST",
            FormatException => "BICEP_FORMATTING_REFUSED",
            _ => "BICEP_INTERNAL_ERROR",
        };
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            protocolVersion,
            error = exception.Message,
            code,
            line = failure?.Line,
            column = failure?.Column,
            diagnosticCode = failure?.DiagnosticCode,
        }, json));
        Environment.ExitCode = 1;
    }
}

record Request(string? Text, string? Filepath, JsonElement Options, string? Parser = null, int? ProtocolVersion = null);
