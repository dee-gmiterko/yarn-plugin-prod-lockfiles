import { Project, Package, Workspace, structUtils, LocatorHash, Descriptor, DescriptorHash } from "@yarnpkg/core";

export interface CollectedPackage {
  locatorHash: LocatorHash;
  pkg: Package;
  isWorkspace: boolean;
  descriptors: Set<Descriptor>;
}

/** Resolve a descriptor to its physical package locator, collapsing peer-dependency virtuals. */
export function resolvePhysicalLocator(project: Project, descriptorHash: DescriptorHash): LocatorHash | undefined {
  const resolution = project.storedResolutions.get(descriptorHash);
  if (!resolution) {
    return undefined;
  }

  const resolvedPkg = project.storedPackages.get(resolution);
  if (resolvedPkg && structUtils.isVirtualLocator(resolvedPkg)) {
    return structUtils.devirtualizeLocator(resolvedPkg).locatorHash;
  }

  return resolution;
}

/**
 * Traverse production dependencies starting from a workspace.
 * Uses BFS to collect all transitive production dependencies.
 * For each package, only follows its `dependencies`, not `devDependencies`.
 */
export function collectProductionDependencies(
  project: Project,
  workspace: Workspace,
): Map<LocatorHash, CollectedPackage> {
  const collected = new Map<LocatorHash, CollectedPackage>();
  const visited = new Set<LocatorHash>();
  const queue: LocatorHash[] = [];
  const descriptorsByLocator = new Map<LocatorHash, Set<Descriptor>>();

  const rootLocatorHash = workspace.anchoredLocator.locatorHash;
  visited.add(rootLocatorHash);
  queue.push(rootLocatorHash);

  while (queue.length > 0) {
    const locatorHash = queue.shift();
    if (locatorHash === undefined) {
      continue;
    }

    const pkg = project.storedPackages.get(locatorHash);

    if (!pkg) {
      continue;
    }

    const pkgWorkspace = project.tryWorkspaceByLocator(pkg);

    collected.set(locatorHash, {
      locatorHash,
      pkg,
      isWorkspace: pkgWorkspace !== null,
      descriptors: descriptorsByLocator.get(locatorHash) || new Set(),
    });

    // For workspaces: filter pkg.dependencies to only production deps (those in manifest.dependencies)
    // For published packages: pkg.dependencies already contains only production deps
    const dependencies = pkgWorkspace ? filterProductionDependencies(pkg, pkgWorkspace) : pkg.dependencies;

    for (const descriptor of dependencies.values()) {
      queueDependency(project, descriptor, visited, queue, descriptorsByLocator);
    }
  }

  return collected;
}

function filterProductionDependencies(pkg: Package, workspace: Workspace): Map<string, Descriptor> {
  const prodDeps = new Map<string, Descriptor>();
  const prodIdentHashes = new Set(workspace.manifest.dependencies.keys());

  for (const [identHash, descriptor] of pkg.dependencies.entries()) {
    if (prodIdentHashes.has(identHash)) {
      prodDeps.set(identHash, descriptor);
    }
  }

  return prodDeps;
}

function queueDependency(
  project: Project,
  descriptor: Descriptor,
  visited: Set<LocatorHash>,
  queue: LocatorHash[],
  descriptorsByLocator: Map<LocatorHash, Set<Descriptor>>,
): void {
  // Skip @types/* packages - they are TypeScript type definitions, not production dependencies
  const descriptorName = structUtils.stringifyIdent(descriptor);
  if (descriptorName.startsWith("@types/")) {
    return;
  }

  const resolution = resolvePhysicalLocator(project, descriptor.descriptorHash);
  if (!resolution) {
    return;
  }

  const baseDescriptor = structUtils.isVirtualDescriptor(descriptor)
    ? structUtils.devirtualizeDescriptor(descriptor)
    : descriptor;

  let descriptors = descriptorsByLocator.get(resolution);
  if (!descriptors) {
    descriptors = new Set();
    descriptorsByLocator.set(resolution, descriptors);
  }
  descriptors.add(baseDescriptor);

  if (visited.has(resolution)) {
    return;
  }

  visited.add(resolution);
  queue.push(resolution);
}
