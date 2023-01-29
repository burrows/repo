import Ajv, {Schema} from 'ajv';
import ajvFormats from 'ajv-formats';

const ajv = new Ajv({allErrors: true});
ajvFormats(ajv);

export type RawRecord = Record<string, unknown>;
export type Options = Record<string, unknown>;
export interface Errors {
  [attribute: string]: string;
}

export class MapperError extends Error {
  public errors: Errors;

  constructor(errors: Errors) {
    super(JSON.stringify(errors));
    this.errors = errors;
  }
}

export interface Mapper {
  fetch(id: number | string, options?: Options): Promise<RawRecord>;

  query(
    options?: Options,
    paging?: {page: number; pageSize?: number},
  ): Promise<{
    records: RawRecord[];
    paging?: {page: number; pageSize: number; count: number};
  }>;

  create(model: Model, options?: Options): Promise<RawRecord>;

  update(model: Model, options?: Options): Promise<RawRecord>;

  delete(model: Model, options?: Options): Promise<void>;
}

export const NullMapper: Mapper = {
  fetch(_id: number | string, _options: Options = {}): Promise<RawRecord> {
    throw new Error(
      'Mapper.get not defined: set the static mapper property on your model to an object that implements the Mapper interface',
    );
  },

  query(
    _options: Options,
    _paging?: {page: number; pageSize?: number},
  ): Promise<{
    records: RawRecord[];
    paging?: {page: number; pageSize: number; count: number};
  }> {
    throw new Error(
      'Mapper.query not defined: set the static mapper property on your model to an object that implements the Mapper interface',
    );
  },

  create(_model: Model, _options: Options = {}): Promise<RawRecord> {
    throw new Error(
      'Mapper.create not defined: set the static mapper property on your model to an object that implements the Mapper interface',
    );
  },

  update(_model: Model, _options: Options = {}): Promise<RawRecord> {
    throw new Error(
      'Mapper.update not defined: set the static mapper property on your model to an object that implements the Mapper interface',
    );
  },

  delete(_model: Model, _options: Options = {}): Promise<void> {
    throw new Error(
      'Mapper.delete not defined: set the static mapper property on your model to an object that implements the Mapper interface',
    );
  },
};

export type ModelState =
  | 'new'
  | 'fetching'
  | 'updating'
  | 'deleting'
  | 'loaded'
  | 'deleted';

interface BaseRecord {
  id: string | number;
}

interface Relations {
  [name: string]: Model[] | Model | null;
}

interface ModelNewOpts {
  state?: ModelState;
  record?: RawRecord;
  errors?: Errors;
  dirty?: {[attr: string]: boolean};
  dirtyRelations?: {[relation: string]: boolean};
  relations?: Relations;
  validate?: boolean;
}

type ModelUpdateOpts = Omit<ModelNewOpts, 'validate'>;

export interface ModelClass<M> extends Function {
  new (opts: ModelNewOpts): M;
  relations: {
    [name: string]: {
      cardinality: 'many' | 'one';
      modelClass: ModelClass<any>;
      inverse?: string;
    };
  };
  mapper: Mapper;
  schema: Schema;
}

const defaultRecord = (schema: any): any => {
  if (!schema) return {};

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return defaultRecord(schema.oneOf[0]);
  }

  if (schema?.type !== 'object') {
    throw new Error(`Model.defaultRecord: can't generate record from schema`);
  }

  const a: any = {};

  for (const k of schema.required || []) {
    const prop = schema?.properties[k];

    if (!prop) {
      throw new Error(
        `Model.defaultRecord: missing property definition for property \`${k}\``,
      );
    }

    if (prop.const) {
      a[k] = prop.const;
      continue;
    }

    if (prop.default) {
      a[k] = prop.default;
      continue;
    }

    let type = prop.type;

    if (!type) {
      throw new Error(
        `Model.defaultRecord: property \`${k}\` is missing a type`,
      );
    }

    if (Array.isArray(type)) {
      type = type[0];
    }

    if (!type) continue;

    switch (type) {
      case 'number':
      case 'integer':
        a[k] = 0;
        break;
      case 'string':
        a[k] = schema.properties[k].enum ? schema.properties[k].enum[0] : '';
        break;
      case 'boolean':
        a[k] = false;
        break;
      case 'array':
        a[k] = [];
        break;
      case 'object':
        a[k] = defaultRecord(schema.properties[k]);
        break;
      case 'null':
        a[k] = null;
        break;
    }
  }

  return a;
};

export default class Model<R extends BaseRecord = {id: number}> {
  static relations: ModelClass<Model>['relations'] = {};
  static mapper: Mapper = NullMapper;
  static schema: Schema = {type: 'object'};

  state: ModelState;
  record: R;
  relations: Relations;
  errors: Errors;
  dirty: {[attr: string]: boolean};
  dirtyRelations: {[relation: string]: boolean};

  constructor({
    state = 'new',
    record,
    errors = {},
    dirty = {},
    dirtyRelations = {},
    relations,
    validate = true,
  }: ModelNewOpts = {}) {
    const rec = {...defaultRecord(this.ctor.schema), ...record} as R;

    if (validate) {
      const validator = ajv.compile(this.ctor.schema);
      if (!validator(rec)) {
        const msg = `${this.name}: record failed validation: ${ajv.errorsText(
          validator.errors,
        )}`;
        throw new Error(msg);
      }
    }

    this.state = state;
    this.record = rec;
    this.errors = errors;
    this.dirty = dirty;
    this.dirtyRelations = dirtyRelations;
    this.relations = relations || this.defaultRelations();
  }

  get ctor(): ModelClass<this> {
    return this.constructor as ModelClass<this>;
  }

  get id(): R['id'] {
    return this.record.id;
  }

  get name(): string {
    return this.ctor.name;
  }

  get key(): string {
    return `${this.name}|${this.id}`;
  }

  get hasError(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  get errorString(): string {
    const errors: string[] = [];

    for (const attr in this.errors) {
      errors.push(`${attr}: ${this.errors[attr]}`);
    }

    return errors.join(', ');
  }

  get isDirty(): boolean {
    return (
      Object.keys(this.dirty).length > 0 ||
      Object.keys(this.dirtyRelations).length > 0
    );
  }

  set(record: Partial<R>): this {
    const dirty = Object.keys(record).reduce((acc, attr) => {
      acc[attr] = true;
      return acc;
    }, {} as {[attr: string]: boolean});

    return this.update({
      record: {...this.record, ...record},
      dirty: {...this.dirty, ...dirty},
    });
  }

  // FIXME: can we improve the typing here?
  setRelated(relation: string, value: Model[] | Model | null): this {
    return this.update({
      relations: {
        ...this.relations,
        [relation]: value,
      },
      dirtyRelations: {...this.dirtyRelations, [relation]: true},
    });
  }

  update({
    state = this.state,
    record,
    errors = this.errors,
    dirty = this.dirty,
    dirtyRelations = this.dirtyRelations,
    relations = this.relations,
  }: ModelUpdateOpts = {}): this {
    return new this.ctor({
      state,
      record: (record || this.record) as RawRecord,
      errors,
      dirty,
      dirtyRelations,
      relations,
      // don't validate if we haven't updated the record or the record is dirty
      validate: record !== this.record && Object.keys(dirty).length === 0,
    });
  }

  private defaultRelations(): Relations {
    const relations: Relations = {};

    for (const relationName in this.ctor.relations) {
      switch (this.ctor.relations[relationName].cardinality) {
        case 'many':
          relations[relationName] = [];
          break;
        case 'one':
          relations[relationName] = null;
          break;
      }
    }

    return relations;
  }
}
