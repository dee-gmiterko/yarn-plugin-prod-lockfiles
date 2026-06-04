import { BaseCommand } from "@yarnpkg/cli";
import { Configuration, Plugin, Project, structUtils } from "@yarnpkg/core";
import { ppath, npath } from "@yarnpkg/fslib";
import { Command, Option } from "clipanion";

import { collectProductionDependencies } from "./traversal";
import { generateProdLockfile, generateDockerPackageJson } from "./lockfile";

class ProdLockfileCommand extends BaseCommand {
  static paths = [[`prod-lockfile`]];

  static usage = Command.Usage({
    description: `Generate a production-only lockfile and package.json`,
    details: `
      This command extracts a minimal yarn.lock and package.json containing only
      production dependencies for the focused workspace. Useful for Docker builds
      where devDependencies should not be installed.
    `,
    examples: [
      [
        `Generate docker files for @my-org/api (no-wrap mode)`,
        `yarn prod-lockfile --focus @my-org/api`,
      ],
      [
        `Generate docker files for @my-org/api with a wrapper package`,
        `yarn prod-lockfile --focus @my-org/api --wrap-package-name @my-org/api-run`,
      ],
    ],
  });

  focus = Option.String(`--focus`, {
    description: `The workspace to focus on`,
    required: true,
  });

  wrapPackageName = Option.String(`--wrap-package-name`, {
    description: `When provided, generates a synthetic wrapper package that lists the focused workspace as its dependency`,
  });

  workspaceVersion = Option.String(`--workspace-version`, `1.0.0`, {
    description: `Version used for workspace packages in the generated files (default: 1.0.0)`,
  });

  outputYarnLock = Option.String(`--output-yarn-lock`, {
    description: `Output path for the production lockfile (default: <workspace-path>/docker.yarn.lock)`,
  });

  outputPackageJson = Option.String(`--output-package-json`, {
    description: `Output path for the generated package.json (default: <workspace-path>/docker.package.json)`,
  });

  async execute(): Promise<number> {
    const configuration = await Configuration.find(this.context.cwd, this.context.plugins);

    const { project } = await Project.find(configuration, this.context.cwd);

    await project.restoreInstallState();

    const focusIdent = structUtils.parseIdent(this.focus);
    const workspace = project.workspaces.find((ws) => {
      const wsIdent = ws.manifest.name;
      return wsIdent && structUtils.areIdentsEqual(wsIdent, focusIdent);
    });

    if (!workspace) {
      this.context.stderr.write(`Workspace not found: ${this.focus}\n`);
      return 1;
    }

    this.context.stdout.write(`Extracting production dependencies for: ${this.focus}\n`);

    const collected = collectProductionDependencies(project, workspace);

    this.context.stdout.write(`Collected ${collected.size} packages\n`);

    const workspaceCwd = workspace.cwd;

    const lockfilePath = this.outputYarnLock
      ? ppath.resolve(this.context.cwd, npath.toPortablePath(this.outputYarnLock))
      : ppath.join(workspaceCwd, `docker.yarn.lock`);

    const packageJsonPath = this.outputPackageJson
      ? ppath.resolve(this.context.cwd, npath.toPortablePath(this.outputPackageJson))
      : ppath.join(workspaceCwd, `docker.package.json`);

    await generateProdLockfile(project, collected, lockfilePath, this.focus, this.workspaceVersion, this.wrapPackageName);
    this.context.stdout.write(`Lockfile: ${lockfilePath}\n`);

    const manifestDeps = Object.fromEntries(
      Array.from(workspace.manifest.dependencies.entries()).map(([, descriptor]) => [
        structUtils.stringifyIdent(descriptor),
        descriptor.range,
      ])
    );

    await generateDockerPackageJson(packageJsonPath, this.focus, manifestDeps, this.workspaceVersion, this.wrapPackageName);
    this.context.stdout.write(`Package JSON: ${packageJsonPath}\n`);

    return 0;
  }
}

const plugin: Plugin = {
  commands: [ProdLockfileCommand],
};

export default plugin;
