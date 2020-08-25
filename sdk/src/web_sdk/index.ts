import { Sdk, SdkEvent, SdkInitState } from '../sdk';
import { createSdk, getRollupProviderStatus } from '../core_sdk/create_sdk';
import { EthProvider, EthProviderEvent, chainIdToNetwork } from './eth_provider';
import { EventEmitter } from 'events';
import { EthAddress } from 'barretenberg/address';
import createDebug from 'debug';

const debug = createDebug('bb:app');

export enum AppInitState {
  UNINITIALIZED = 'UNINITIALIZED',
  INITIALIZING = 'INITIALIZING',
  INITIALIZED = 'INITIALIZED',
}

export enum AppInitAction {
  LINK_PROVIDER_ACCOUNT,
  LINK_AZTEC_ACCOUNT,
  CHANGE_NETWORK,
}

export enum AppEvent {
  UPDATED_INIT_STATE = 'APPEVENT_UPDATED_INIT_STATE',
}

export interface AppInitStatus {
  initState: AppInitState;
  initAction?: AppInitAction;
  account?: EthAddress;
  network?: string;
  message?: string;
}

/**
 * Simplifies integration of the CoreSdk with a provider such as MetaMask.
 * The event stream will always be ordered like, but may not always include, the following:
 *
 * Initialization starts:
 * UPDATED_INIT_STATE => INITIALIZING, LINK_PROVIDER_ACCOUNT
 * UPDATED_INIT_STATE => INITIALIZING, CHANGE_NETWORK
 * UPDATED_INIT_STATE => INITIALIZING, "info message 1"
 * UPDATED_INIT_STATE => INITIALIZING, "info message 2"
 * UPDATED_INIT_STATE => INITIALIZING, LINK_AZTEC_ACCOUNT
 * UPDATED_INIT_STATE => INITIALIZED, address 1
 * UPDATED_INIT_STATE => INITIALIZING, LINK_AZTEC_ACCOUNT
 * UPDATED_INIT_STATE => INITIALIZED, address 2
 * UPDATED_INIT_STATE => INITIALIZED, address 1
 * UPDATED_INIT_STATE => DESTROYED
 */
export class WebSdk extends EventEmitter {
  private sdk!: Sdk;
  private ethProvider!: EthProvider;
  private initStatus: AppInitStatus = { initState: AppInitState.UNINITIALIZED };

  constructor(private provider: any) {
    super();
  }

  public async init(serverUrl: string, clearDb = false) {
    debug('initializing app...');

    try {
      this.updateInitStatus(AppInitState.INITIALIZING, AppInitAction.LINK_PROVIDER_ACCOUNT);

      this.ethProvider = new EthProvider(this.provider);
      await this.ethProvider.init();

      // If our network doesn't match that of the rollup provider, request it be changed until it does.
      const { chainId: rollupProviderChainId } = await getRollupProviderStatus(serverUrl);
      this.initStatus.network = chainIdToNetwork(rollupProviderChainId);
      if (rollupProviderChainId !== this.ethProvider.getChainId()) {
        this.updateInitStatus(AppInitState.INITIALIZING, AppInitAction.CHANGE_NETWORK);
        while (rollupProviderChainId !== this.ethProvider.getChainId()) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      this.sdk = await createSdk(serverUrl, this.provider, { clearDb });

      // Forward all sdk events. This allows subscribing to the events on the App, before we have called init().
      for (const e in SdkEvent) {
        const event = (SdkEvent as any)[e];
        this.sdk.on(event, (...args: any[]) => this.emit(event, ...args));
      }

      // Handle SDK init messages.
      this.sdk.on(SdkEvent.UPDATED_INIT_STATE, (initState: SdkInitState, msg?: string) => {
        if (initState === SdkInitState.INITIALIZING) {
          this.updateInitStatus(AppInitState.INITIALIZING, undefined, msg);
        }
      });

      await this.sdk.init();

      // Link account. Will be INITIALZED once complete.
      await this.accountChanged(this.ethProvider.getAccount());

      // Handle account changes.
      this.ethProvider.on(EthProviderEvent.UPDATED_ACCOUNT, (account?: EthAddress) => {
        this.accountChanged(account).catch(() => this.destroy());
      });

      // Ensure we're still on correct network, and attach handler.
      // Any network changes at this point result in destruction.
      this.networkChanged();
      this.ethProvider.on(EthProviderEvent.UPDATED_NETWORK, this.networkChanged);

      debug('initialization complete.');
    } catch (err) {
      this.destroy();
      throw err;
    }
  }

  private updateInitStatus(initState: AppInitState, initAction?: AppInitAction, message?: string) {
    this.initStatus = {
      ...this.initStatus,
      initState,
      initAction,
      message,
    };
    this.emit(AppEvent.UPDATED_INIT_STATE, { ...this.initStatus });
  }

  private accountChanged = (account?: EthAddress) => {
    this.initStatus.account = account;
    if (!account) {
      // If the user withdraws access, destroy everything and return to uninitialized state.
      throw new Error('Account access withdrawn.');
    }
    const user = this.sdk.getUser(account);
    if (!user) {
      // We are initializing until the account is added to sdk.
      this.updateInitStatus(AppInitState.INITIALIZING, AppInitAction.LINK_AZTEC_ACCOUNT);
      return this.sdk.addUser(account).then(() => {
        this.updateInitStatus(AppInitState.INITIALIZED);
      });
    } else {
      this.updateInitStatus(AppInitState.INITIALIZED);
    }
    return Promise.resolve();
  };

  private networkChanged = () => {
    if (!this.isCorrectNetwork()) {
      this.destroy();
    }
  };

  public async destroy() {
    debug('destroying app...');
    await this.sdk?.destroy();
    this.ethProvider?.destroy();
    this.initStatus.account === undefined;
    this.updateInitStatus(AppInitState.UNINITIALIZED);
  }

  public getSdk() {
    return this.sdk;
  }

  public isInitialized() {
    return this.getInitStatus().initState === AppInitState.INITIALIZED;
  }

  public isCorrectNetwork() {
    const { chainId } = this.sdk.getLocalStatus();
    return this.ethProvider.getChainId() === chainId;
  }

  public getInitStatus() {
    return this.initStatus;
  }

  public getUser() {
    return this.sdk.getUser(this.initStatus.account!)!;
  }
}