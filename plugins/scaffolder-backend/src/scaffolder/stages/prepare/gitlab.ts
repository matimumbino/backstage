/*
 * Copyright 2020 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { InputError, Git } from '@backstage/backend-common';
import { TemplateEntityV1alpha1 } from '@backstage/catalog-model';
import { Config } from '@backstage/config';
import {
  GitLabIntegrationConfig,
  readGitLabIntegrationConfigs,
} from '@backstage/integration';
import fs from 'fs-extra';
import GitUriParser from 'git-url-parse';
import os from 'os';
import path from 'path';
import { parseLocationAnnotation } from '../helpers';
import { PreparerBase, PreparerOptions } from './types';
import { Logger } from 'winston';

export class GitlabPreparer implements PreparerBase {
  private readonly integrations: GitLabIntegrationConfig[];
  private readonly scaffolderToken: string | undefined;
  private readonly logger: Logger;

  constructor(config: Config, { logger }: { logger: Logger }) {
    this.logger = logger;
    this.integrations = readGitLabIntegrationConfigs(
      config.getOptionalConfigArray('integrations.gitlab') ?? [],
    );

    if (!this.integrations.length) {
      this.logger.warn(
        'Integrations for GitLab in Scaffolder are not set. This will cause errors in a future release. Please migrate to using integrations config and specifying tokens under hostnames',
      );
    }

    this.scaffolderToken = config.getOptionalString(
      'scaffolder.gitlab.api.token',
    );

    if (this.scaffolderToken) {
      this.logger.warn(
        "DEPRECATION: Using the token format under 'scaffolder.gitlab.api.token' will not be respected in future releases. Please consider using integrations config instead",
      );
    }
  }

  async prepare(
    template: TemplateEntityV1alpha1,
    opts?: PreparerOptions,
  ): Promise<string> {
    const { protocol, location } = parseLocationAnnotation(template);
    const workingDirectory = opts?.workingDirectory ?? os.tmpdir();

    if (!['gitlab', 'gitlab/api', 'url'].includes(protocol)) {
      throw new InputError(
        `Wrong location protocol: ${protocol}, should be 'url'`,
      );
    }
    const templateId = template.metadata.name;

    const parsedGitLocation = GitUriParser(location);
    const repositoryCheckoutUrl = parsedGitLocation.toString('https');
    const tempDir = await fs.promises.mkdtemp(
      path.join(workingDirectory, templateId),
    );

    const templateDirectory = path.join(
      `${path.dirname(parsedGitLocation.filepath)}`,
      template.spec.path ?? '.',
    );

    const token = this.getToken(parsedGitLocation.resource);
    const git = token
      ? Git.fromAuth({
          password: token,
          username: 'oauth2',
          logger: this.logger,
        })
      : Git.fromAuth({ logger: this.logger });

    await git.clone({
      url: repositoryCheckoutUrl,
      dir: tempDir,
    });

    return path.resolve(tempDir, templateDirectory);
  }

  private getToken(host: string): string | undefined {
    return (
      this.scaffolderToken ||
      this.integrations.find(c => c.host === host)?.token
    );
  }
}
