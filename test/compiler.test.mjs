import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { format } from "prettier";
import plugin from "../dist/index.js";

const exec = promisify(execFile);
function canonical(value, key = "") {
  if (Array.isArray(value)) {
    const values = value.map((item) => canonical(item));
    return ["resources", "dependsOn"].includes(key)
      ? values.sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        )
      : values;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((name) => !(key === "_generator" && name === "templateHash"))
        .sort()
        .map((name) => [name, canonical(value[name], name)]),
    );
  }
  return value;
}

test("Bicep CLI emits equivalent templates before and after formatting", async () => {
  await exec("bicep", ["--version"]);
  await mkdir("artifacts", { recursive: true });
  const directory = await mkdtemp(resolve("artifacts", "compiler-"));
  try {
    const sources = [
      "param location string='westeurope'\nvar tags={owner:'team'}\nresource first 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'={tags:tags,location:location,name:'first'}\nresource second 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'={tags:{parent:first.id},location:location,name:'second'}\noutput firstId string=first.id\n",
      "type Child={enabled:bool}\n@sealed()\n@description('Configuration.')\ntype Parent={child:Child}\nparam config Parent={child:{enabled:true}}\noutput enabled bool=config.child.enabled\n",
      "param name string='world'\noutput text string='''\n  hello  \n\n    world\n'''\noutput greeting string='\\u{4e16}\\u{754c} ${name}'\n",
      "@maxLength(20)\n@description('Name.')\n@minLength(3)\nparam name string='example'\noutput name string=name\n",
      "param widgets array=[{name:'tile'}]\nvar widgetResults=[for widget in widgets: {outputs:{metadata:{name:widget.name},entries:[]}}]\noutput catalog array=[for (widget,i) in widgets: union(widgetResults[i].outputs.metadata, {\nentries:widgetResults[i].outputs.entries\n})]\n",
      "param computeProfiles array=[{properties:{accelerated:true}}]\nvar i=0\noutput plan object={usesAcceleration:union({ accelerated : false },computeProfiles[i].properties).accelerated}\n",
      "param profile object={}\n// Options for the secondary profile\nparam profileOptions object={}\noutput result object=union(profile,profileOptions)\n",
      "param volumes array=[{type:'SharedDisk',volume:{share:'one'}}]\noutput config object={mounted:length(volumes)>0?union({first:{share:volumes[0].type =~ 'SharedDisk'?volumes[0].volume.share:volumes[0].type =~ 'ObjectDisk'?'object':''}},length(volumes)>1?{second:{share:volumes[1].type =~ 'SharedDisk'?'x':'y'}}:{}):{}}\n",
      "param enabled bool=true\noutput config object={gatewayOptions:enabled?{id:'management'}:null,spec:enabled?{url:'https://example.com'}:null}\n",
      "output policies array=filter(map(items(union({policies:{rule:{deploy:true}}},{policies:{}}).policies),policy=>union({lookupKey:policy.key},policy.value)),policy=>policy.deploy)\n",
      "param recordConfig object={sku:{name:'Starter'},discountAvailable:false}\noutput config object={pricingTier:recordConfig.sku.name =~ 'Shared' || startsWith(recordConfig.sku.name,'S') || startsWith(recordConfig.sku.name,'P') || startsWith(recordConfig.sku.name,'Starter') || contains(recordConfig.sku.name,'_T_')?null:recordConfig.discountAvailable?'Discounted':'Regular'}\n",
      "param name string='Starter'\noutput enabled bool=startsWith(name,'Starter') || contains(name,'_T_')\n",
      "param recordConfig object={replica:{sourceName:''},status:'waiting',protectionMode:'Configured'}\nresource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'=if(!empty(recordConfig.replica.sourceName)||recordConfig.status =~ 'paused'||recordConfig.status =~ 'active'?false:recordConfig.protectionMode !~ 'Disabled'){name:'identity',location:'westeurope'}\n",
    ];
    for (const [index, source] of sources.entries()) {
      const input = join(directory, `before-${index}.bicep`);
      const output = join(directory, `after-${index}.bicep`);
      await writeFile(input, source);
      await writeFile(
        output,
        await format(source, { plugins: [plugin], filepath: input }),
      );
      await exec("bicep", ["build", input, "--no-restore"]);
      await exec("bicep", ["build", output, "--no-restore"]);
      const before = JSON.parse(
        await readFile(input.replace(/\.bicep$/, ".json"), "utf8"),
      );
      const after = JSON.parse(
        await readFile(output.replace(/\.bicep$/, ".json"), "utf8"),
      );
      assert.deepEqual(
        canonical(after),
        canonical(before),
        `Template semantics changed for case ${index}`,
      );
    }
    const source =
      "@description('A description that must not change when the call wraps.')\nparam enabled bool=true\ntype Config={optional:string?,required:'dev'|'prod'}\nparam config Config={required:'dev'}\nresource consumer 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'=if(enabled){name:'consumer',location:'westeurope',tags:{parent:dependency.id}}\nresource unrelated 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'={name:'unrelated',location:'westeurope'}\nresource dependency 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'={name:'dependency',location:'westeurope'}\noutput values array=map(['one','two'],value=>value)\noutput environment string=config.required\n";
    const beforeFile = join(directory, "policies-before.bicep");
    const afterFile = join(directory, "policies-after.bicep");
    await writeFile(beforeFile, source);
    await writeFile(
      afterFile,
      await format(source, {
        plugins: [plugin],
        filepath: beforeFile,
        printWidth: 60,
        bicepDependencyOrder: "dependencies-first",
        bicepConditionalHeader: "next-line",
        bicepUnionLayout: "multiline",
        bicepTypeMemberOrder: "required-first",
        bicepLambdaParentheses: "always",
        bicepDescriptionWidth: "wrap",
        bicepResourcePropertyOrder: ["location", "*", "name"],
      }),
    );
    await exec("bicep", ["build", beforeFile, "--no-restore"]);
    await exec("bicep", ["build", afterFile, "--no-restore"]);
    assert.deepEqual(
      canonical(
        JSON.parse(
          await readFile(afterFile.replace(/\.bicep$/, ".json"), "utf8"),
        ),
      ),
      canonical(
        JSON.parse(
          await readFile(beforeFile.replace(/\.bicep$/, ".json"), "utf8"),
        ),
      ),
      "Nondefault policies changed template semantics",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
