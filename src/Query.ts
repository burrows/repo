import Model, {Options, ModelClass} from './Model';

export type QueryState = 'new' | 'getting' | 'loaded' | 'error';

export default class Query<M extends Model> {
  public modelClass: ModelClass<M>;
  public state: QueryState;
  public options: Options;
  public error?: string;
  public pageSize?: number;
  public models: (M | undefined)[];
  public pendingPages: {[page: number]: boolean};

  constructor(
    modelClass: ModelClass<M>,
    {
      state = 'new',
      options = {},
      error,
      pageSize,
      models = [],
      pendingPages = {},
    }: {
      state?: QueryState;
      options?: Options;
      error?: string;
      pageSize?: number;
      models?: (M | undefined)[];
      pendingPages?: {[page: number]: boolean};
    } = {},
  ) {
    this.modelClass = modelClass;
    this.state = state;
    this.options = options;
    this.error = error;
    this.pageSize = pageSize;
    this.models = models;
    this.pendingPages = pendingPages;
  }

  isPagePending(page: number): boolean {
    return page in this.pendingPages;
  }

  update({
    state,
    models,
    pendingPages,
    error,
  }: {
    state?: QueryState;
    models?: (M | undefined)[];
    pendingPages?: {[page: number]: boolean};
    error?: string;
  }): Query<M> {
    return new Query(this.modelClass, {
      options: this.options,
      state: state || this.state,
      models: models || this.models,
      pendingPages: pendingPages || this.pendingPages,
      error: error || this.error,
    });
  }
}
