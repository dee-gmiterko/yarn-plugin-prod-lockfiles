import {describe, expect, it, vi, beforeEach} from 'vitest';
import {
  Project,
  Workspace,
  Package,
  Manifest,
  Descriptor,
  Locator,
  IdentHash,
  LocatorHash,
  DescriptorHash,
  LinkType,
  structUtils,
} from '@yarnpkg/core';

import {collectProductionDependencies} from '../sources/traversal.js';

function createMockDescriptor(name: string, range: string = '^1.0.0'): Descriptor {
  const ident = structUtils.parseIdent(name);
  return structUtils.makeDescriptor(ident, range);
}

function createMockLocator(name: string, reference: string = 'npm:1.0.0'): Locator {
  const ident = structUtils.parseIdent(name);
  return structUtils.makeLocator(ident, reference);
}

function createMockPackage(
  locator: Locator,
  dependencies: Map<IdentHash, Descriptor> = new Map<IdentHash, Descriptor>(),
): Package {
  return {
    ...locator,
    version: '1.0.0',
    languageName: 'node',
    linkType: LinkType.HARD,
    dependencies,
    peerDependencies: new Map<IdentHash, Descriptor>(),
    dependenciesMeta: new Map(),
    peerDependenciesMeta: new Map(),
    bin: new Map(),
  };
}

describe('collectProductionDependencies', () => {
  it('should collect the focused workspace itself', () => {
    const rootLocator = createMockLocator('@my-org/api', 'workspace:.');
    const rootLocatorHash = rootLocator.locatorHash;

    const mockManifest = {
      dependencies: new Map<any, Descriptor>(),
      devDependencies: new Map<any, Descriptor>(),
    } as unknown as Manifest;

    const mockWorkspace = {
      anchoredLocator: rootLocator,
      manifest: mockManifest,
    } as unknown as Workspace;

    const mockPackage = {
      identHash: rootLocator.identHash,
      reference: rootLocator.reference,
      dependencies: new Map<any, Descriptor>(),
    } as unknown as Package;

    const storedPackages = new Map<LocatorHash, Package>();
    storedPackages.set(rootLocatorHash, mockPackage);

    const mockProject = {
      storedPackages,
      storedResolutions: new Map<DescriptorHash, LocatorHash>(),
      tryWorkspaceByLocator: () => mockWorkspace,
    } as unknown as Project;

    const result = collectProductionDependencies(mockProject, mockWorkspace);

    expect(result.size).toBe(1);
    expect(result.has(rootLocatorHash)).toBe(true);

    const collected = result.get(rootLocatorHash);
    expect(collected?.isWorkspace).toBe(true);
    expect(collected?.descriptors).toBeInstanceOf(Set);
    expect(collected?.descriptors.size).toBe(0);
  });

  it('should collect production dependencies but not devDependencies', () => {
    const rootLocator = createMockLocator('@my-org/api', 'workspace:.');
    const prodDepLocator = createMockLocator('express', 'npm:5.0.0');
    const devDepLocator = createMockLocator('vitest', 'npm:1.0.0');

    const prodDescriptor = createMockDescriptor('express', '^5.0.0');
    const devDescriptor = createMockDescriptor('vitest', '^1.0.0');

    const prodDeps = new Map<any, Descriptor>();
    prodDeps.set(prodDescriptor.identHash, prodDescriptor);

    const devDeps = new Map<any, Descriptor>();
    devDeps.set(devDescriptor.identHash, devDescriptor);

    const mockManifest = {
      dependencies: prodDeps,
      devDependencies: devDeps,
    } as unknown as Manifest;

    const mockWorkspace = {
      anchoredLocator: rootLocator,
      manifest: mockManifest,
    } as unknown as Workspace;

    // CRITICAL: For workspaces, pkg.dependencies contains BOTH prod and dev deps
    const allDeps = new Map<any, Descriptor>();
    allDeps.set(prodDescriptor.identHash, prodDescriptor);
    allDeps.set(devDescriptor.identHash, devDescriptor);

    const rootPackage = {
      identHash: rootLocator.identHash,
      reference: rootLocator.reference,
      locatorHash: rootLocator.locatorHash,
      dependencies: allDeps,
    } as unknown as Package;

    const prodPackage = {
      identHash: prodDepLocator.identHash,
      reference: prodDepLocator.reference,
      dependencies: new Map<any, Descriptor>(),
    } as unknown as Package;

    const devPackage = {
      identHash: devDepLocator.identHash,
      reference: devDepLocator.reference,
      dependencies: new Map<any, Descriptor>(),
    } as unknown as Package;

    const storedPackages = new Map<LocatorHash, Package>();
    storedPackages.set(rootLocator.locatorHash, rootPackage);
    storedPackages.set(prodDepLocator.locatorHash, prodPackage);
    storedPackages.set(devDepLocator.locatorHash, devPackage);

    const storedResolutions = new Map<DescriptorHash, LocatorHash>();
    storedResolutions.set(prodDescriptor.descriptorHash, prodDepLocator.locatorHash);
    storedResolutions.set(devDescriptor.descriptorHash, devDepLocator.locatorHash);

    const mockProject = {
      storedPackages,
      storedResolutions,
      tryWorkspaceByLocator: (locator: Locator) => {
        if (locator.locatorHash === rootLocator.locatorHash) {
          return mockWorkspace;
        }
        return null;
      },
    } as unknown as Project;

    const result = collectProductionDependencies(mockProject, mockWorkspace);

    // Should have root + express, but NOT vitest
    expect(result.size).toBe(2);
    expect(result.has(rootLocator.locatorHash)).toBe(true);
    expect(result.has(prodDepLocator.locatorHash)).toBe(true);
    expect(result.has(devDepLocator.locatorHash)).toBe(false);

    const expressCollected = result.get(prodDepLocator.locatorHash);
    expect(expressCollected?.descriptors).toBeInstanceOf(Set);
    expect(expressCollected?.descriptors.size).toBe(1);
    expect(Array.from(expressCollected?.descriptors || [])[0]).toMatchObject({
      identHash: prodDescriptor.identHash,
      range: prodDescriptor.range,
    });
  });

  it('should traverse transitive production dependencies', () => {
    const rootLocator = createMockLocator('@my-org/api', 'workspace:.');
    const expressLocator = createMockLocator('express', 'npm:5.0.0');
    const bodyParserLocator = createMockLocator('body-parser', 'npm:1.0.0');

    const expressDescriptor = createMockDescriptor('express', '^5.0.0');
    const bodyParserDescriptor = createMockDescriptor('body-parser', '^1.0.0');

    const rootManifestDeps = new Map<any, Descriptor>();
    rootManifestDeps.set(expressDescriptor.identHash, expressDescriptor);

    const rootPkgDeps = new Map<any, Descriptor>();
    rootPkgDeps.set(expressDescriptor.identHash, expressDescriptor);

    const expressDeps = new Map<any, Descriptor>();
    expressDeps.set(bodyParserDescriptor.identHash, bodyParserDescriptor);

    const mockManifest = {
      dependencies: rootManifestDeps,
      devDependencies: new Map<any, Descriptor>(),
    } as unknown as Manifest;

    const mockWorkspace = {
      anchoredLocator: rootLocator,
      manifest: mockManifest,
    } as unknown as Workspace;

    const rootPackage = {
      identHash: rootLocator.identHash,
      reference: rootLocator.reference,
      locatorHash: rootLocator.locatorHash,
      dependencies: rootPkgDeps,
    } as unknown as Package;

    const expressPackage = {
      identHash: expressLocator.identHash,
      reference: expressLocator.reference,
      dependencies: expressDeps,
    } as unknown as Package;

    const bodyParserPackage = {
      identHash: bodyParserLocator.identHash,
      reference: bodyParserLocator.reference,
      dependencies: new Map<any, Descriptor>(),
    } as unknown as Package;

    const storedPackages = new Map<LocatorHash, Package>();
    storedPackages.set(rootLocator.locatorHash, rootPackage);
    storedPackages.set(expressLocator.locatorHash, expressPackage);
    storedPackages.set(bodyParserLocator.locatorHash, bodyParserPackage);

    const storedResolutions = new Map<DescriptorHash, LocatorHash>();
    storedResolutions.set(expressDescriptor.descriptorHash, expressLocator.locatorHash);
    storedResolutions.set(bodyParserDescriptor.descriptorHash, bodyParserLocator.locatorHash);

    const mockProject = {
      storedPackages,
      storedResolutions,
      tryWorkspaceByLocator: (locator: Locator) => {
        if (locator.locatorHash === rootLocator.locatorHash) {
          return mockWorkspace;
        }
        return null;
      },
    } as unknown as Project;

    const result = collectProductionDependencies(mockProject, mockWorkspace);

    // Should have root + express + body-parser
    expect(result.size).toBe(3);
    expect(result.has(rootLocator.locatorHash)).toBe(true);
    expect(result.has(expressLocator.locatorHash)).toBe(true);
    expect(result.has(bodyParserLocator.locatorHash)).toBe(true);
  });

  it('should collect dependencies of workspace dependencies', () => {
    // admin-api depends on @my-org/common (workspace)
    // @my-org/common depends on @google-cloud/monitoring (npm package)
    const adminApiLocator = createMockLocator('@my-org/api', 'workspace:.');
    const commonLocator = createMockLocator('@my-org/common', 'workspace:shared/common');
    const monitoringLocator = createMockLocator('@google-cloud/monitoring', 'npm:3.0.0');

    const commonDescriptor = createMockDescriptor('@my-org/common', 'workspace:^');
    const monitoringDescriptor = createMockDescriptor('@google-cloud/monitoring', '^3.0.0');

    const adminApiManifestDeps = new Map<any, Descriptor>();
    adminApiManifestDeps.set(commonDescriptor.identHash, commonDescriptor);

    const adminApiPkgDeps = new Map<any, Descriptor>();
    adminApiPkgDeps.set(commonDescriptor.identHash, commonDescriptor);

    const commonManifestDeps = new Map<any, Descriptor>();
    commonManifestDeps.set(monitoringDescriptor.identHash, monitoringDescriptor);

    const commonPkgDeps = new Map<any, Descriptor>();
    commonPkgDeps.set(monitoringDescriptor.identHash, monitoringDescriptor);

    const adminApiManifest = {
      dependencies: adminApiManifestDeps,
      devDependencies: new Map<any, Descriptor>(),
    } as unknown as Manifest;

    const commonManifest = {
      dependencies: commonManifestDeps,
      devDependencies: new Map<any, Descriptor>(),
    } as unknown as Manifest;

    const adminApiWorkspace = {
      anchoredLocator: adminApiLocator,
      manifest: adminApiManifest,
    } as unknown as Workspace;

    const commonWorkspace = {
      anchoredLocator: commonLocator,
      manifest: commonManifest,
    } as unknown as Workspace;

    const adminApiPackage = {
      identHash: adminApiLocator.identHash,
      reference: adminApiLocator.reference,
      locatorHash: adminApiLocator.locatorHash,
      dependencies: adminApiPkgDeps,
    } as unknown as Package;

    const commonPackage = {
      identHash: commonLocator.identHash,
      reference: commonLocator.reference,
      locatorHash: commonLocator.locatorHash,
      dependencies: commonPkgDeps,
    } as unknown as Package;

    const monitoringPackage = {
      identHash: monitoringLocator.identHash,
      reference: monitoringLocator.reference,
      dependencies: new Map<any, Descriptor>(),
    } as unknown as Package;

    const storedPackages = new Map<LocatorHash, Package>();
    storedPackages.set(adminApiLocator.locatorHash, adminApiPackage);
    storedPackages.set(commonLocator.locatorHash, commonPackage);
    storedPackages.set(monitoringLocator.locatorHash, monitoringPackage);

    const storedResolutions = new Map<DescriptorHash, LocatorHash>();
    storedResolutions.set(commonDescriptor.descriptorHash, commonLocator.locatorHash);
    storedResolutions.set(monitoringDescriptor.descriptorHash, monitoringLocator.locatorHash);

    const mockProject = {
      storedPackages,
      storedResolutions,
      tryWorkspaceByLocator: (locator: Locator) => {
        if (locator.locatorHash === adminApiLocator.locatorHash) {
          return adminApiWorkspace;
        }
        if (locator.locatorHash === commonLocator.locatorHash) {
          return commonWorkspace;
        }
        return null;
      },
    } as unknown as Project;

    const result = collectProductionDependencies(mockProject, adminApiWorkspace);

    // Should have admin-api + @my-org/common + @google-cloud/monitoring
    expect(result.size).toBe(3);
    expect(result.has(adminApiLocator.locatorHash)).toBe(true);
    expect(result.has(commonLocator.locatorHash)).toBe(true);
    expect(result.has(monitoringLocator.locatorHash)).toBe(true);
  });

  it('should collapse virtual instances of a peer-dependent package into a single physical entry', () => {
    // express-rate-limit declares `express` as a peer dependency, so Yarn
    // virtualizes it into multiple locators (one per peer-resolution context).
    // Two different ranges reaching it through different parents resolve to two
    // distinct virtual locators that devirtualize to the same physical package.
    const rootLocator = createMockLocator('@my-org/app', 'workspace:.');
    const barLocator = createMockLocator('bar', 'npm:1.0.0');
    const erlBaseLocator = createMockLocator('express-rate-limit', 'npm:8.5.2');
    const erlVirtA = createMockLocator('express-rate-limit', 'virtual:aaaa1111#npm:8.5.2');
    const erlVirtB = createMockLocator('express-rate-limit', 'virtual:bbbb2222#npm:8.5.2');

    const barDescriptor = createMockDescriptor('bar', '^1.0.0');
    const erlDescriptorA = createMockDescriptor('express-rate-limit', '^8.5.2');
    const erlDescriptorB = createMockDescriptor('express-rate-limit', '^8.2.1');

    const rootDeps = new Map<IdentHash, Descriptor>();
    rootDeps.set(erlDescriptorA.identHash, erlDescriptorA);
    rootDeps.set(barDescriptor.identHash, barDescriptor);

    const barDeps = new Map<IdentHash, Descriptor>();
    barDeps.set(erlDescriptorB.identHash, erlDescriptorB);

    const mockManifest = {
      dependencies: rootDeps,
      devDependencies: new Map<IdentHash, Descriptor>(),
    } as unknown as Manifest;

    const mockWorkspace = {
      anchoredLocator: rootLocator,
      manifest: mockManifest,
    } as unknown as Workspace;

    const storedPackages = new Map<LocatorHash, Package>();
    storedPackages.set(rootLocator.locatorHash, createMockPackage(rootLocator, rootDeps));
    storedPackages.set(barLocator.locatorHash, createMockPackage(barLocator, barDeps));
    storedPackages.set(erlBaseLocator.locatorHash, createMockPackage(erlBaseLocator));
    storedPackages.set(erlVirtA.locatorHash, createMockPackage(erlVirtA));
    storedPackages.set(erlVirtB.locatorHash, createMockPackage(erlVirtB));

    const storedResolutions = new Map<DescriptorHash, LocatorHash>();
    storedResolutions.set(barDescriptor.descriptorHash, barLocator.locatorHash);
    storedResolutions.set(erlDescriptorA.descriptorHash, erlVirtA.locatorHash);
    storedResolutions.set(erlDescriptorB.descriptorHash, erlVirtB.locatorHash);

    const mockProject = {
      storedPackages,
      storedResolutions,
      tryWorkspaceByLocator: (locator: Locator) =>
        locator.locatorHash === rootLocator.locatorHash ? mockWorkspace : null,
    } as unknown as Project;

    const result = collectProductionDependencies(mockProject, mockWorkspace);

    // express-rate-limit must appear exactly once, as the physical (non-virtual) package.
    const erlEntries = Array.from(result.values()).filter(
      collected => collected.pkg.name === 'express-rate-limit',
    );
    expect(erlEntries).toHaveLength(1);
    expect(structUtils.isVirtualLocator(erlEntries[0].pkg)).toBe(false);

    // Keyed by the physical locator, not either virtual one.
    expect(result.has(erlBaseLocator.locatorHash)).toBe(true);
    expect(result.has(erlVirtA.locatorHash)).toBe(false);
    expect(result.has(erlVirtB.locatorHash)).toBe(false);

    // Both ranges merged onto the single entry.
    const ranges = Array.from(erlEntries[0].descriptors).map(d => d.range).sort();
    expect(ranges).toEqual(['^8.2.1', '^8.5.2']);
  });
});
