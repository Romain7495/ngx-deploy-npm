import { DeployExecutorOptions } from '../schema';
import { npmAccess } from '../../../core';
import * as engine from './engine';
import * as spawn from '../utils/spawn-async';
import * as setPackage from '../utils/set-package-version';
import { mockProjectDist, mockProjectRoot } from '../../../__mocks__/mocks';
import * as fileUtils from '../../../utils';

jest.mock('../../../utils', () => {
  return {
    __esModule: true, //    <----- this __esModule: true is important
    ...jest.requireActual('../../../utils'),
  };
});

describe('engine', () => {
  const defaultOption: Readonly<Omit<DeployExecutorOptions, 'distFolderPath'>> =
    Object.freeze({
      access: npmAccess.public,
    });
  const setup = ({
    options = defaultOption,
    rootProject = mockProjectRoot,
    distFolderPath = mockProjectDist(),
    spawnAsyncReturnValue = () => Promise.resolve(),
  }: {
    rootProject?: string;
    distFolderPath?: string;
    spawnAsyncReturnValue?: () => Promise<void>;
    options?: Omit<DeployExecutorOptions, 'distFolderPath'>;
  }) => {
    const fullOptions: DeployExecutorOptions = {
      ...options,
      distFolderPath,
    };
    jest.spyOn(spawn, 'spawnAsync').mockImplementation(spawnAsyncReturnValue);

    return {
      absoluteDistFolderPath: `${rootProject}/${distFolderPath}`,
      options: fullOptions,
    };
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call NPM Publish with the right options', async () => {
    const expectedOptionsArray = [
      '--access',
      npmAccess.restricted,
      '--tag',
      'next',
      '--otp',
      'someValue',
      '--dry-run',
      'true',
      '--registry',
      'http://localhost:4873',
    ];
    const { absoluteDistFolderPath, options } = setup({
      options: {
        access: npmAccess.restricted,
        tag: 'next',
        otp: 'someValue',
        registry: 'http://localhost:4873',
        dryRun: true,
      },
    });

    await engine.run(absoluteDistFolderPath, options);

    expect(spawn.spawnAsync).toHaveBeenCalledWith('npm', [
      'publish',
      absoluteDistFolderPath,
      ...expectedOptionsArray,
    ]);
  });

  it('should indicate that an error occurred when there is an error publishing the package', async () => {
    const { absoluteDistFolderPath, options } = setup({
      spawnAsyncReturnValue: () => Promise.reject(new Error('custom error')),
    });

    await expect(() =>
      engine.run(absoluteDistFolderPath, options)
    ).rejects.toThrow();
  });

  describe('Package.json Feature', () => {
    const pJsonSetup = ({
      version = '1.0.1-next0',
      setPackageReturnValue = Promise.resolve(),
      ...originalSetupOptions
    }: {
      version?: string;
      setPackageReturnValue?: Promise<void>;
    } & Parameters<typeof setup>[0]) => {
      jest
        .spyOn(setPackage, 'setPackageVersion')
        .mockImplementation(() => setPackageReturnValue);

      if (!originalSetupOptions.options) {
        originalSetupOptions.options = { ...defaultOption };
      }

      originalSetupOptions.options.packageVersion = version;

      return {
        version,
        ...setup(originalSetupOptions),
      };
    };

    it('should write the version of the sent on the package.json', async () => {
      const { absoluteDistFolderPath, version, options } = pJsonSetup({});

      await engine.run(absoluteDistFolderPath, options);

      expect(setPackage.setPackageVersion).toHaveBeenCalledWith(
        absoluteDistFolderPath,
        version
      );
    });

    it('should not write the version of the sent on the package.json if is on dry-run mode', async () => {
      const { absoluteDistFolderPath, options } = pJsonSetup({
        options: {
          access: npmAccess.public,
          dryRun: true,
        },
      });

      await engine.run(absoluteDistFolderPath, options);

      expect(setPackage.setPackageVersion).not.toHaveBeenCalled();
    });
  });

  describe('Package Version Check Feature', () => {
    const mockPackageJson = {
      name: '@test/package',
      version: '1.0.0',
    };

    const versionCheckSetup = ({
      ...originalSetupOptions
    }: Parameters<typeof setup>[0] = {}) => {
      jest
        .spyOn(fileUtils, 'readFileAsync')
        .mockImplementation(() =>
          Promise.resolve(JSON.stringify(mockPackageJson))
        );

      return setup(originalSetupOptions);
    };

    it('should skip publishing when package exists and checkExisting is warning', async () => {
      const { absoluteDistFolderPath, options } = versionCheckSetup({
        options: {
          ...defaultOption,
          checkExisting: 'warning',
        },
        spawnAsyncReturnValue: () => Promise.resolve(),
      });

      await engine.run(absoluteDistFolderPath, {
        ...options,
        checkExisting: 'warning',
      });

      // Verify package check was performed
      expect(spawn.spawnAsync).toHaveBeenCalledWith('npm', [
        'view',
        `${mockPackageJson.name}@${mockPackageJson.version}`,
        'version',
      ]);

      // Verify publish was not called
      expect(spawn.spawnAsync).not.toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['publish'])
      );
    });

    it('should throw error when package exists and checkExisting is "error"', async () => {
      const { absoluteDistFolderPath, options } = versionCheckSetup({
        options: {
          ...defaultOption,
          checkExisting: 'error',
        },
      });

      // Mock npm view to succeed (package exists)
      jest
        .spyOn(spawn, 'spawnAsync')
        .mockImplementationOnce(() => Promise.resolve());

      // Should throw error when package exists
      await expect(() =>
        engine.run(absoluteDistFolderPath, {
          ...options,
          checkExisting: 'error',
        })
      ).rejects.toThrow();

      // Verify check was performed but publish was not attempted
      expect(spawn.spawnAsync).toHaveBeenCalledWith('npm', [
        'view',
        `${mockPackageJson.name}@${mockPackageJson.version}`,
        'version',
      ]);
      expect(spawn.spawnAsync).not.toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['publish'])
      );
    });
  });
});
