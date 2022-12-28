import {FromSchema} from 'json-schema-to-ts';
import Repo, {MapperAction} from './Repo';
import Model, {MapperError, NullMapper, Options} from './Model';
import Query from './Query';

const PostRecordSchema = {
  type: 'object',
  required: ['id', 'title'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer'},
    title: {type: 'string', minLength: 1, default: 'New Post'},
  },
} as const;

const PostMapper = {
  ...NullMapper,

  nextId: 1,

  fetch(id: number, _options: Options) {
    switch (id) {
      case 1:
        return Promise.resolve({id: 1, title: 'First Post!'});
      case 2:
        return Promise.resolve({id: 1, title: 'Second Post!'});
      case 3:
        return Promise.resolve({id: 1, title: 'Third Post!'});
      default:
        return Promise.reject(new Error('boom'));
    }
  },

  create(model: Post, options: Options = {}) {
    if (options.error) {
      return Promise.reject(new MapperError({title: 'invalid title'}));
    }

    return Promise.resolve({...model.record, id: this.nextId++});
  },

  update(model: Post, options: Options = {}) {
    if (options.error) {
      return Promise.reject(new MapperError({title: 'invalid title'}));
    }

    return Promise.resolve({...model.record});
  },

  delete(model: Post, options: Options = {}) {
    if (options.error) {
      return Promise.reject(new MapperError({base: 'delete failed'}));
    }

    return Promise.resolve({id: model.id});
  },
};

class Post extends Model<FromSchema<typeof PostRecordSchema>> {
  static mapper = PostMapper;
  static schema = PostRecordSchema;

  static get relations() {
    return {
      author: {
        cardinality: 'one' as const,
        modelClass: Author,
        inverse: 'posts',
      },
      comments: {
        cardinality: 'many' as const,
        modelClass: Comment,
        inverse: 'post',
      },
    };
  }

  get author(): Author | null {
    return this.relations.author as Author | null;
  }

  get comments(): Comment[] {
    return this.relations.comments as Comment[];
  }
}

const AuthorRecordSchema = {
  type: 'object',
  required: ['id', 'firstName', 'lastName'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer'},
    firstName: {type: 'string', minLength: 1, default: 'First'},
    lastName: {type: 'string', minLength: 1, default: 'Last'},
  },
} as const;

const authors = [
  {id: 1, firstName: 'Homer', lastName: 'Simpson'},
  {id: 2, firstName: 'Marge', lastName: 'Simpson'},
  {id: 3, firstName: 'Bart', lastName: 'Simpson'},
  {id: 4, firstName: 'Lisa', lastName: 'Simpson'},
  {id: 5, firstName: 'Maggie', lastName: 'Simpson'},
  {id: 6, firstName: 'Ned', lastName: 'Flanders'},
  {id: 7, firstName: 'Maude', lastName: 'Flanders'},
  {id: 8, firstName: 'Rod', lastName: 'Flanders'},
  {id: 9, firstName: 'Todd', lastName: 'Flanders'},
  {id: 10, firstName: 'Seymore', lastName: 'Skinner'},
  {id: 11, firstName: 'Edna', lastName: 'Krabappel'},
];

const AuthorMapper = {
  ...NullMapper,

  query(options: Options, paging?: {page: number; pageSize?: number}) {
    if (options.error) return Promise.reject(new Error('boom'));

    let records = options.lastName
      ? authors.filter(a => a.lastName === options.lastName)
      : authors;
    const pageSize = paging?.pageSize ?? 3;
    const count = records.length;

    if (paging) {
      records = records.slice(
        paging.page * pageSize,
        (paging.page + 1) * pageSize,
      );
    }

    return Promise.resolve({
      records,
      paging: paging ? {page: paging.page, pageSize, count} : undefined,
    });
  },
};

class Author extends Model<FromSchema<typeof AuthorRecordSchema>> {
  static mapper = AuthorMapper;
  static schema = AuthorRecordSchema;

  static get relations() {
    return {
      posts: {
        cardinality: 'many' as const,
        modelClass: Post,
        inverse: 'author',
      },
      comments: {
        cardinality: 'many' as const,
        modelClass: Comment,
        inverse: 'author',
      },
    };
  }

  get posts(): Post[] {
    return this.relations.posts as Post[];
  }

  get comments(): Comment[] {
    return this.relations.comments as Comment[];
  }
}

const CommentRecordSchema = {
  type: 'object',
  required: ['id', 'text'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer'},
    text: {type: 'string'},
  },
} as const;

class Comment extends Model<FromSchema<typeof CommentRecordSchema>> {
  static schema = CommentRecordSchema;

  static get relations() {
    return {
      author: {
        cardinality: 'one' as const,
        modelClass: Author,
        inverse: 'comments',
      },
      post: {
        cardinality: 'one' as const,
        modelClass: Post,
        inverse: 'posts',
      },
    };
  }

  get author(): Author | null {
    return this.relations.author as Author | null;
  }

  get post(): Post | null {
    return this.relations.post as Post | null;
  }
}

describe('Repo#upsert', () => {
  describe('with records containing no relations', () => {
    it('loads a single model', () => {
      const r = new Repo().upsert(Post, {id: 1, title: 'a'});
      const p = r.getModel(Post, 1);

      expect(p instanceof Post).toBe(true);
      expect(p!.state).toBe('loaded');
      expect(p!.id).toBe(1);
      expect(p!.record.title).toBe('a');
    });

    it('loads a multiple models', () => {
      const r = new Repo().upsert(Author, [
        {id: 1, firstName: 'Homer', lastName: 'Simpson'},
        {id: 2, firstName: 'Marge', lastName: 'Simpson'},
        {id: 3, firstName: 'Bart', lastName: 'Simpson'},
        {id: 4, firstName: 'Lisa', lastName: 'Simpson'},
      ]);

      let a = r.getModel(Author, 1);

      expect(a instanceof Author).toBe(true);
      expect(a!.state).toBe('loaded');
      expect(a!.id).toBe(1);
      expect(a!.record.firstName).toBe('Homer');

      a = r.getModel(Author, 4);

      expect(a instanceof Author).toBe(true);
      expect(a!.state).toBe('loaded');
      expect(a!.id).toBe(4);
      expect(a!.record.firstName).toBe('Lisa');
    });
  });

  describe('with records containing nested related records', () => {
    it('loads the given model and its related models', () => {
      const r = new Repo().upsert(Post, {
        id: 1,
        title: 'post 1',
        author: {
          id: 10,
          firstName: 'Homer',
          lastName: 'Simpson',
        },
        comments: [
          {
            id: 1,
            text: 'comment 1',
            author: {id: 20, firstName: 'Marge', lastName: 'Simpson'},
          },
          {
            id: 2,
            text: 'comment 2',
            author: {id: 30, firstName: 'Bart', lastName: 'Simpson'},
          },
          {
            id: 3,
            text: 'comment 3',
            author: {id: 20, firstName: 'Marge', lastName: 'Simpson'},
          },
          {
            id: 4,
            text: 'comment 4',
            author: {id: 10, firstName: 'Homer', lastName: 'Simpson'},
          },
        ],
      });

      const p = r.getModel(Post, 1);
      expect(p instanceof Post).toBe(true);
      expect(p!.state).toBe('loaded');
      expect(p!.id).toBe(1);
      expect(p!.record.title).toBe('post 1');

      expect(p!.author instanceof Author).toBe(true);
      expect(p!.author!.state).toBe('loaded');
      expect(p!.author!.id).toBe(10);
      expect(p!.author!.record.firstName).toBe('Homer');
      expect(Array.isArray(p!.author!.posts)).toBe(true);
      expect(p!.author!.posts!.includes(p!)).toBe(true);

      expect(Array.isArray(p!.comments)).toBe(true);
      expect(p!.comments![0] instanceof Comment).toBe(true);
      expect(p!.comments![0].state).toBe('loaded');
      expect(p!.comments![0].id).toBe(1);
      expect(p!.comments![0].record.text).toBe('comment 1');
      expect(p!.comments![0].author instanceof Author).toBe(true);
      expect(p!.comments![0].author!.id).toBe(20);
      expect(p!.comments![0].author!.record.firstName).toBe('Marge');
      expect(p!.comments![0].post).toBe(p);

      expect(p!.comments![1] instanceof Comment).toBe(true);
      expect(p!.comments![1].state).toBe('loaded');
      expect(p!.comments![1].id).toBe(2);
      expect(p!.comments![1].record.text).toBe('comment 2');
      expect(p!.comments![1].author instanceof Author).toBe(true);
      expect(p!.comments![1].author!.id).toBe(30);
      expect(p!.comments![1].author!.record.firstName).toBe('Bart');
      expect(p!.comments![1].post).toBe(p);

      expect(p!.comments![2] instanceof Comment).toBe(true);
      expect(p!.comments![2].state).toBe('loaded');
      expect(p!.comments![2].id).toBe(3);
      expect(p!.comments![2].record.text).toBe('comment 3');
      expect(p!.comments![2].author instanceof Author).toBe(true);
      expect(p!.comments![2].author!.id).toBe(20);
      expect(p!.comments![2].author!.record.firstName).toBe('Marge');
      expect(p!.comments![2].author).toBe(p!.comments[0].author);
      expect(p!.comments![2].post).toBe(p);

      expect(p!.comments![3] instanceof Comment).toBe(true);
      expect(p!.comments![3].state).toBe('loaded');
      expect(p!.comments![3].id).toBe(4);
      expect(p!.comments![3].record.text).toBe('comment 4');
      expect(p!.comments![3].author instanceof Author).toBe(true);
      expect(p!.comments![3].author!.id).toBe(10);
      expect(p!.comments![3].author!.record.firstName).toBe('Homer');
      expect(p!.comments![3].author).toBe(p!.author);
      expect(p!.comments![3].post).toBe(p);

      const homer = r.getModel(Author, 10);
      const marge = r.getModel(Author, 20);

      expect(homer instanceof Author).toBe(true);
      expect(homer!.state).toBe('loaded');
      expect(Array.isArray(homer!.posts)).toBe(true);
      expect(homer!.posts).toEqual([p]);
      expect(Array.isArray(homer!.comments)).toBe(true);
      expect(homer!.comments).toEqual([p!.comments[3]]);

      expect(marge instanceof Author).toBe(true);
      expect(marge!.state).toBe('loaded');
      expect(Array.isArray(marge!.posts)).toBe(true);
      expect(marge!.posts).toEqual([]);
      expect(Array.isArray(marge!.comments)).toBe(true);
      expect(marge!.comments).toEqual([p!.comments[0], p!.comments[2]]);
    });

    it('loads empty related models', () => {
      const r = new Repo().upsert(Post, {
        id: 1,
        title: 'post 1',
        author: {id: 10},
        comments: [1, 2, 3, 4],
      });

      const a = r.getModel(Author, 10);
      const c = r.getModel(Comment, 1);
      const p = r.getModel(Post, 1);

      expect(a instanceof Author).toBe(true);
      expect(a!.id).toBe(10);
      expect(a!.state).toBe('loaded');
      expect(a!.record).toEqual({id: 10, firstName: 'First', lastName: 'Last'});
      expect(a!.posts).toEqual([p]);

      expect(c instanceof Comment).toBe(true);
      expect(c!.id).toBe(1);
      expect(c!.state).toBe('loaded');
      expect(c!.record).toEqual({id: 1, text: ''});
      expect(c!.post).toBe(p);

      expect(p instanceof Post).toBe(true);
      expect(p!.id).toBe(1);
      expect(p!.author instanceof Author).toBe(true);
      expect(p!.author!.id).toBe(10);
      expect(p!.author!).toBe(a);
      expect(Array.isArray(p!.comments)).toBe(true);
      expect(p!.comments![0].id).toBe(1);
      expect(p!.comments![0]).toBe(c);
    });
  });

  describe('with queries present', () => {
    it('updates the queries that contain the newly loaded models', () => {
      let r = new Repo().upsertQuery(
        Author,
        {x: 1},
        {
          records: [
            {id: 1, firstName: 'Homer', lastName: 'Simpson'},
            {id: 3, firstName: 'Bart', lastName: 'Simpson'},
          ],
        },
      );

      r = r.upsertQuery(
        Author,
        {x: 2},
        {
          records: [
            {id: 2, firstName: 'Marge', lastName: 'Simpson'},
            {id: 4, firstName: 'Lisa', lastName: 'Simpson'},
          ],
        },
      );

      r = r.upsert(Post, {
        id: 1,
        title: 'a',
        author: {id: 3, firstName: 'Bartholomew', lastName: 'Simpson'},
      });

      const q = r.getQuery(Author, {x: 1})!;
      const a = q.models.find(m => m?.id === 3);

      expect(a instanceof Author).toBe(true);
      expect(a!.record.firstName).toBe('Bartholomew');
      expect(a!.record.lastName).toBe('Simpson');
    });
  });
});

describe('Repo#upsertQuery', () => {
  it('loads the models and assigns them to a Query object', () => {
    const r = new Repo().upsertQuery(
      Author,
      {},
      {
        records: [
          {id: 1, firstName: 'Homer', lastName: 'Simpson'},
          {id: 2, firstName: 'Marge', lastName: 'Simpson'},
          {id: 3, firstName: 'Bart', lastName: 'Simpson'},
        ],
      },
    );

    const as = r.getQuery(Author, {});

    expect(as instanceof Query).toBe(true);
    expect(as!.models.length).toBe(3);
    expect(as!.models[0] instanceof Author).toBe(true);
    expect(as!.models[0]!.id).toBe(1);
    expect(as!.models[0]!.record.firstName).toBe('Homer');
    expect(as!.models[1] instanceof Author).toBe(true);
    expect(as!.models[1]!.id).toBe(2);
    expect(as!.models[1]!.record.firstName).toBe('Marge');
    expect(as!.models[2] instanceof Author).toBe(true);
    expect(as!.models[2]!.id).toBe(3);
    expect(as!.models[2]!.record.firstName).toBe('Bart');
  });

  describe('with paging parameters', () => {
    it('creates a sparse array', () => {
      let r = new Repo().upsertQuery(
        Author,
        {},
        {
          records: [
            {id: 1, firstName: 'Homer', lastName: 'Simpson'},
            {id: 2, firstName: 'Marge', lastName: 'Simpson'},
            {id: 3, firstName: 'Bart', lastName: 'Simpson'},
          ],
          paging: {page: 0, pageSize: 3, count: 10},
        },
      );

      let as = r.getQuery(Author, {});
      expect(as instanceof Query).toBe(true);
      expect(as!.models.length).toBe(10);
      expect(as!.models[0] instanceof Author).toBe(true);
      expect(as!.models[0]!.id).toBe(1);
      expect(as!.models[0]!.record.firstName).toBe('Homer');
      expect(as!.models[1] instanceof Author).toBe(true);
      expect(as!.models[1]!.id).toBe(2);
      expect(as!.models[1]!.record.firstName).toBe('Marge');
      expect(as!.models[2] instanceof Author).toBe(true);
      expect(as!.models[2]!.id).toBe(3);
      expect(as!.models[2]!.record.firstName).toBe('Bart');
      for (let i = 3; i <= 9; i++) {
        expect(as!.models[i]).toBeUndefined();
      }

      r = r.upsertQuery(
        Author,
        {},
        {
          records: [
            {id: 7, firstName: 'Ned', lastName: 'Flanders'},
            {id: 8, firstName: 'Maude', lastName: 'Flanders'},
            {id: 9, firstName: 'Chief', lastName: 'Wiggum'},
          ],
          paging: {page: 2, pageSize: 3, count: 10},
        },
      );

      as = r.getQuery(Author, {});
      expect(as instanceof Query).toBe(true);
      expect(as!.models.length).toBe(10);
      expect(as!.models[0] instanceof Author).toBe(true);
      expect(as!.models[0]!.id).toBe(1);
      expect(as!.models[0]!.record.firstName).toBe('Homer');
      expect(as!.models[1] instanceof Author).toBe(true);
      expect(as!.models[1]!.id).toBe(2);
      expect(as!.models[1]!.record.firstName).toBe('Marge');
      expect(as!.models[2] instanceof Author).toBe(true);
      expect(as!.models[2]!.id).toBe(3);
      expect(as!.models[2]!.record.firstName).toBe('Bart');
      expect(as!.models[3]).toBeUndefined();
      expect(as!.models[4]).toBeUndefined();
      expect(as!.models[5]).toBeUndefined();
      expect(as!.models[6] instanceof Author).toBe(true);
      expect(as!.models[6]!.id).toBe(7);
      expect(as!.models[6]!.record.firstName).toBe('Ned');
      expect(as!.models[7] instanceof Author).toBe(true);
      expect(as!.models[7]!.id).toBe(8);
      expect(as!.models[7]!.record.firstName).toBe('Maude');
      expect(as!.models[8] instanceof Author).toBe(true);
      expect(as!.models[8]!.id).toBe(9);
      expect(as!.models[8]!.record.firstName).toBe('Chief');
      expect(as!.models[9]).toBeUndefined();
    });
  });
});

describe('Repo#fetch', () => {
  it(`adds an empty model and returns a RepoAction that calls the mapper's fetch method`, async () => {
    let r = new Repo();
    let a: MapperAction;

    [r, a] = r.fetch(Post, 1);

    let p = r.getModel(Post, 1);

    expect(p instanceof Post).toBe(true);
    expect(p!.id).toBe(1);
    expect(p!.state).toBe('fetching');
    expect(p!.record).toEqual({id: 1, title: 'New Post'});

    const result = await a();

    r = r.processMapperResult(result);

    p = r.getModel(Post, 1);
    expect(p instanceof Post).toBe(true);
    expect(p!.id).toBe(1);
    expect(p!.state).toBe('loaded');
    expect(p!.record).toEqual({id: 1, title: 'First Post!'});
  });

  describe('when an error occurs', () => {
    it('adds a base error to the model', async () => {
      let r = new Repo();
      let a: MapperAction;

      [r, a] = r.fetch(Post, 99999);

      let p = r.getModel(Post, 99999);

      expect(p instanceof Post).toBe(true);
      expect(p!.id).toBe(99999);
      expect(p!.state).toBe('fetching');
      expect(p!.record).toEqual({id: 99999, title: 'New Post'});
      expect(p!.errors).toEqual({});

      const result = await a();

      r = r.processMapperResult(result);

      p = r.getModel(Post, 99999);
      expect(p instanceof Post).toBe(true);
      expect(p!.id).toBe(99999);
      expect(p!.state).toBe('loaded');
      expect(p!.record).toEqual({id: 99999, title: 'New Post'});
      expect(p!.errors).toEqual({base: 'boom'});
    });
  });
});

describe('Repo#query', () => {
  it(`adds an empty query and returns a RepoAction that calls the mapper's query method`, async () => {
    let r = new Repo();
    let a: MapperAction;

    [r, a] = r.query(Author, {});

    let q = r.getQuery(Author, {});

    expect(q instanceof Query).toBe(true);
    expect(q!.modelClass).toBe(Author);
    expect(q!.state).toBe('getting');
    expect(q!.models).toEqual([]);

    const result = await a();

    r = r.processMapperResult(result);

    q = r.getQuery(Author, {});
    expect(q instanceof Query).toBe(true);
    expect(q!.modelClass).toBe(Author);
    expect(q!.state).toBe('loaded');
    expect(q!.models.length).toEqual(authors.length);
    expect(q!.models[0] instanceof Author).toBe(true);
    expect(q!.models[0]!.id).toBe(1);
    expect(q!.models[0]!.record).toEqual({
      id: 1,
      firstName: 'Homer',
      lastName: 'Simpson',
    });
  });

  describe('when an error occurs', () => {
    it('adds an error to the query', async () => {
      let r = new Repo();
      let a: MapperAction;

      [r, a] = r.query(Author, {error: true});

      let q = r.getQuery(Author, {error: true});

      expect(q instanceof Query).toBe(true);
      expect(q!.modelClass).toBe(Author);
      expect(q!.state).toBe('getting');
      expect(q!.models).toEqual([]);

      const result = await a();

      r = r.processMapperResult(result);

      q = r.getQuery(Author, {error: true});
      expect(q instanceof Query).toBe(true);
      expect(q!.modelClass).toBe(Author);
      expect(q!.state).toBe('error');
      expect(q!.error).toBe('boom');
    });
  });

  describe('with options', () => {
    it('creates queries with the given options', async () => {
      let r = new Repo();
      let a1: MapperAction;
      let a2: MapperAction;

      [r, a1] = r.query(Author, {lastName: 'Simpson'});
      [r, a2] = r.query(Author, {lastName: 'Flanders'});

      const wiggums = r.getQuery(Author, {lastName: 'Wiggum'});
      expect(wiggums).toBeUndefined();

      let simpsons = r.getQuery(Author, {lastName: 'Simpson'});
      let flanders = r.getQuery(Author, {lastName: 'Flanders'});

      expect(simpsons instanceof Query).toBe(true);
      expect(simpsons!.state).toBe('getting');
      expect(flanders instanceof Query).toBe(true);
      expect(flanders!.state).toBe('getting');

      let result = await a1();
      r = r.processMapperResult(result);

      simpsons = r.getQuery(Author, {lastName: 'Simpson'});
      flanders = r.getQuery(Author, {lastName: 'Flanders'});

      expect(simpsons instanceof Query).toBe(true);
      expect(simpsons!.state).toBe('loaded');
      expect(flanders instanceof Query).toBe(true);
      expect(flanders!.state).toBe('getting');

      result = await a2();
      r = r.processMapperResult(result);

      simpsons = r.getQuery(Author, {lastName: 'Simpson'});
      flanders = r.getQuery(Author, {lastName: 'Flanders'});

      expect(simpsons instanceof Query).toBe(true);
      expect(simpsons!.state).toBe('loaded');
      expect(flanders instanceof Query).toBe(true);
      expect(flanders!.state).toBe('loaded');

      expect(simpsons!.models.map(a => a?.record.firstName)).toEqual([
        'Homer',
        'Marge',
        'Bart',
        'Lisa',
        'Maggie',
      ]);
      expect(flanders!.models.map(a => a?.record.firstName)).toEqual([
        'Ned',
        'Maude',
        'Rod',
        'Todd',
      ]);
    });
  });

  describe('with pagination', () => {
    it('creates a sparse models array with the page of records returned by the mappers', async () => {
      let r = new Repo();
      let a: MapperAction;

      [r, a] = r.query(Author, {}, {page: 0, pageSize: 3});

      let q = r.getQuery(Author, {});

      expect(q instanceof Query).toBe(true);
      expect(q!.modelClass).toBe(Author);
      expect(q!.state).toBe('getting');
      expect(q!.models).toEqual([]);

      r = r.processMapperResult(await a());

      q = r.getQuery(Author, {});

      expect(q instanceof Query).toBe(true);
      expect(q!.modelClass).toBe(Author);
      expect(q!.state).toBe('loaded');
      expect(q!.models.length).toEqual(11);
      expect(q!.models.map(m => m?.id)).toEqual([
        1,
        2,
        3,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);

      [r, a] = r.query(Author, {}, {page: 1});

      r = r.processMapperResult(await a());

      q = r.getQuery(Author, {});

      expect(q instanceof Query).toBe(true);
      expect(q!.modelClass).toBe(Author);
      expect(q!.state).toBe('loaded');
      expect(q!.models.length).toEqual(11);
      expect(q!.models.map(m => m?.id)).toEqual([
        1,
        2,
        3,
        4,
        5,
        6,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);

      [r, a] = r.query(Author, {}, {page: 3});

      r = r.processMapperResult(await a());

      q = r.getQuery(Author, {});

      expect(q instanceof Query).toBe(true);
      expect(q!.modelClass).toBe(Author);
      expect(q!.state).toBe('loaded');
      expect(q!.models.length).toEqual(11);
      expect(q!.models.map(m => m?.id)).toEqual([
        1,
        2,
        3,
        4,
        5,
        6,
        undefined,
        undefined,
        undefined,
        10,
        11,
      ]);
    });
  });
});

describe('Repo#create', () => {
  it(`returns a RepoAction that calls the mapper's create method`, async () => {
    let r = new Repo();
    let a: MapperAction;

    let p: Post | undefined = new Post({record: {title: 'My Post'}});

    expect(p.state).toBe('new');

    [r, a] = r.create(p);

    const result = await a();

    expect(result.type).toBe('create:success');
    if (result.type === 'create:success') {
      expect(result.modelClass).toBe(Post);
      const id = result.record!.id as number;

      r = r.processMapperResult(result);

      p = r.getModel(Post, id);
      expect(p instanceof Post).toBe(true);
      expect(p!.id).toBe(id);
      expect(p!.state).toBe('loaded');
      expect(p!.record).toEqual({id, title: 'My Post'});
    }
  });

  describe('when the mapper returns an error', () => {
    it('makes the error available in the mapper result', async () => {
      let r = new Repo();
      let a: MapperAction;

      let p: Post | undefined = new Post({record: {title: 'My Post'}});

      expect(p.state).toBe('new');

      [r, a] = r.create(p, {error: true});

      const result = await a();

      expect(result.type).toBe('create:error');
      if (result.type === 'create:error') {
        expect(result.model.record).toEqual(p.record);
        expect(result.model.errors).toEqual({title: 'invalid title'});
      }
    });
  });
});

describe('Repo#update', () => {
  it(`sets the model state to updating and returns a RepoAction that calls the mapper's update method`, async () => {
    let r = new Repo();
    let a: MapperAction;

    [r, a] = r.fetch(Post, 1);

    r = r.processMapperResult(await a());

    let p = r.getModel(Post, 1);

    expect(p instanceof Post).toBe(true);
    expect(p!.state).toBe('loaded');

    p = p!.set({title: p!.record.title + ' (2)'});

    expect(p.state).toBe('loaded');

    [r, a] = r.update(p);

    p = r.getModel(Post, 1);
    expect(p instanceof Post).toBe(true);
    expect(p!.state).toBe('updating');

    r = r.processMapperResult(await a());

    p = r.getModel(Post, 1);
    expect(p instanceof Post).toBe(true);
    expect(p!.state).toBe('loaded');
    expect(p!.errors).toEqual({});
    expect(p!.record).toEqual({id: 1, title: 'First Post! (2)'});
  });

  describe('when the mapper returns an error', () => {
    it('adds the errors to the model', async () => {
      let r = new Repo();
      let a: MapperAction;

      [r, a] = r.fetch(Post, 1);

      r = r.processMapperResult(await a());

      let p = r.getModel(Post, 1);

      expect(p instanceof Post).toBe(true);
      expect(p!.state).toBe('loaded');

      p = p!.set({title: p!.record.title + ' (2)'});

      [r, a] = r.update(p, {error: true});

      p = r.getModel(Post, 1);
      expect(p instanceof Post).toBe(true);
      expect(p!.state).toBe('updating');

      r = r.processMapperResult(await a());

      p = r.getModel(Post, 1);
      expect(p instanceof Post).toBe(true);
      expect(p!.state).toBe('loaded');
      expect(p!.errors).toEqual({title: 'invalid title'});
      expect(p!.record).toEqual({id: 1, title: 'First Post! (2)'});

      [r, a] = r.update(p!);

      p = r.getModel(Post, 1);
      expect(p instanceof Post).toBe(true);
      expect(p!.state).toBe('updating');

      r = r.processMapperResult(await a());

      p = r.getModel(Post, 1);
      expect(p instanceof Post).toBe(true);
      expect(p!.state).toBe('loaded');
      expect(p!.errors).toEqual({});
      expect(p!.record).toEqual({id: 1, title: 'First Post! (2)'});
    });
  });
});

describe('Repo#delete', () => {
  it(`sets the model state to deleting and returns a RepoAction that calls the mapper's delete method`, async () => {
    let r = new Repo();
    let a: MapperAction;

    [r, a] = r.fetch(Post, 1);

    r = r.processMapperResult(await a());

    let p = r.getModel(Post, 1);

    expect(p instanceof Post).toBe(true);
    expect(p!.state).toBe('loaded');

    [r, a] = r.delete(p!);

    p = r.getModel(Post, 1);
    expect(p instanceof Post).toBe(true);
    expect(p!.state).toBe('deleting');

    r = r.processMapperResult(await a());

    p = r.getModel(Post, 1);
    expect(p instanceof Post).toBe(true);
    expect(p!.state).toBe('deleted');
    expect(p!.errors).toEqual({});
  });

  describe('when the mapper returns an error', () => {
    it('adds the errors to the model', async () => {
      let r = new Repo();
      let a: MapperAction;

      [r, a] = r.fetch(Post, 1);

      r = r.processMapperResult(await a());

      let p = r.getModel(Post, 1);

      expect(p instanceof Post).toBe(true);
      expect(p!.state).toBe('loaded');

      p = p!.set({title: p!.record.title + ' (2)'});

      [r, a] = r.delete(p, {error: true});

      p = r.getModel(Post, 1);
      expect(p instanceof Post).toBe(true);
      expect(p!.state).toBe('deleting');

      r = r.processMapperResult(await a());

      p = r.getModel(Post, 1);
      expect(p instanceof Post).toBe(true);
      expect(p!.state).toBe('loaded');
      expect(p!.errors).toEqual({base: 'delete failed'});
    });
  });
});
