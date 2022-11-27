import Model, {ModelClass} from './Model';

export type QueryState = 'new' | 'getting' | 'loaded' | 'error';

export default class Query<M extends Model> {
  public modelClass: ModelClass<M>;
  public state: QueryState;
  public options: Record<string, unknown>;
  public models: M[];

  constructor(
    modelClass: ModelClass<M>,
    {
      state = 'new',
      options = {},
      models = [],
    }: {
      state?: QueryState;
      options?: Record<string, unknown>;
      models?: M[];
    },
  ) {
    this.modelClass = modelClass;
    this.state = state;
    this.options = options;
    this.models = models;
  }

  update({state, models}: {state?: QueryState; models?: M[]}): Query<M> {
    return new Query(this.modelClass, {
      options: this.options,
      state: state || this.state,
      models: models || this.models,
    });
  }
}
