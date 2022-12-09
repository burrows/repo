import {FromSchema} from 'json-schema-to-ts';
import Repo, {MapperAction} from './Repo';
import Model from './Model';
import Query from './Query';

const PostAttributesSchema = {
  type: 'object',
  required: ['id', 'title'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer'},
    title: {type: 'string', minLength: 1},
  },
} as const;

const PostMapper = {
  fetch(id: number, _options: Record<string, unknown>) {
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
};

class Post extends Model<FromSchema<typeof PostAttributesSchema>> {
  static mapper = PostMapper;

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

const AuthorAttributesSchema = {
  type: 'object',
  required: ['id', 'firstName', 'lastName'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer'},
    firstName: {type: 'string', minLength: 1},
    lastName: {type: 'string', minLength: 1},
  },
} as const;

class Author extends Model<FromSchema<typeof AuthorAttributesSchema>> {
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

const CommentAttributesSchema = {
  type: 'object',
  required: ['id', 'text'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer'},
    text: {type: 'string'},
  },
} as const;

class Comment extends Model<FromSchema<typeof CommentAttributesSchema>> {
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

describe('Repo#load', () => {
  describe('with records containing no relations', () => {
    it('loads a single model', () => {
      const r = new Repo().load(Post, {id: 1, title: 'a'});
      const p = r.getModel(Post, 1);

      expect(p instanceof Post).toBe(true);
      expect(p!.state).toBe('loaded');
      expect(p!.id).toBe(1);
      expect(p!.attributes.title).toBe('a');
    });

    it('loads a multiple models', () => {
      const r = new Repo().load(Author, [
        {id: 1, firstName: 'Homer', lastName: 'Simpson'},
        {id: 2, firstName: 'Marge', lastName: 'Simpson'},
        {id: 3, firstName: 'Bart', lastName: 'Simpson'},
        {id: 4, firstName: 'Lisa', lastName: 'Simpson'},
      ]);

      let a = r.getModel(Author, 1);

      expect(a instanceof Author).toBe(true);
      expect(a!.state).toBe('loaded');
      expect(a!.id).toBe(1);
      expect(a!.attributes.firstName).toBe('Homer');

      a = r.getModel(Author, 4);

      expect(a instanceof Author).toBe(true);
      expect(a!.state).toBe('loaded');
      expect(a!.id).toBe(4);
      expect(a!.attributes.firstName).toBe('Lisa');
    });
  });

  describe('with records containing nested related records', () => {
    it('loads the given model and its related models', () => {
      const r = new Repo().load(Post, {
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
      expect(p!.attributes.title).toBe('post 1');

      expect(p!.author instanceof Author).toBe(true);
      expect(p!.author!.state).toBe('loaded');
      expect(p!.author!.id).toBe(10);
      expect(p!.author!.attributes.firstName).toBe('Homer');
      expect(Array.isArray(p!.author!.posts)).toBe(true);
      expect(p!.author!.posts!.includes(p!)).toBe(true);

      expect(Array.isArray(p!.comments)).toBe(true);
      expect(p!.comments![0] instanceof Comment).toBe(true);
      expect(p!.comments![0].state).toBe('loaded');
      expect(p!.comments![0].id).toBe(1);
      expect(p!.comments![0].attributes.text).toBe('comment 1');
      expect(p!.comments![0].author instanceof Author).toBe(true);
      expect(p!.comments![0].author!.id).toBe(20);
      expect(p!.comments![0].author!.attributes.firstName).toBe('Marge');
      expect(p!.comments![0].post).toBe(p);

      expect(p!.comments![1] instanceof Comment).toBe(true);
      expect(p!.comments![1].state).toBe('loaded');
      expect(p!.comments![1].id).toBe(2);
      expect(p!.comments![1].attributes.text).toBe('comment 2');
      expect(p!.comments![1].author instanceof Author).toBe(true);
      expect(p!.comments![1].author!.id).toBe(30);
      expect(p!.comments![1].author!.attributes.firstName).toBe('Bart');
      expect(p!.comments![1].post).toBe(p);

      expect(p!.comments![2] instanceof Comment).toBe(true);
      expect(p!.comments![2].state).toBe('loaded');
      expect(p!.comments![2].id).toBe(3);
      expect(p!.comments![2].attributes.text).toBe('comment 3');
      expect(p!.comments![2].author instanceof Author).toBe(true);
      expect(p!.comments![2].author!.id).toBe(20);
      expect(p!.comments![2].author!.attributes.firstName).toBe('Marge');
      expect(p!.comments![2].author).toBe(p!.comments[0].author);
      expect(p!.comments![2].post).toBe(p);

      expect(p!.comments![3] instanceof Comment).toBe(true);
      expect(p!.comments![3].state).toBe('loaded');
      expect(p!.comments![3].id).toBe(4);
      expect(p!.comments![3].attributes.text).toBe('comment 4');
      expect(p!.comments![3].author instanceof Author).toBe(true);
      expect(p!.comments![3].author!.id).toBe(10);
      expect(p!.comments![3].author!.attributes.firstName).toBe('Homer');
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
      const r = new Repo().load(Post, {
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
      expect(a!.state).toBe('empty');
      expect(a!.attributes).toEqual({id: 10});
      expect(a!.posts).toEqual([p]);

      expect(c instanceof Comment).toBe(true);
      expect(c!.id).toBe(1);
      expect(c!.state).toBe('empty');
      expect(c!.attributes).toEqual({id: 1});
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
      let r = new Repo().loadQuery(Author, {x: 1}, [
        {id: 1, firstName: 'Homer', lastName: 'Simpson'},
        {id: 3, firstName: 'Bart', lastName: 'Simpson'},
      ]);

      r = r.loadQuery(Author, {x: 2}, [
        {id: 2, firstName: 'Marge', lastName: 'Simpson'},
        {id: 4, firstName: 'Lisa', lastName: 'Simpson'},
      ]);

      r = r.load(Post, {
        id: 1,
        title: 'a',
        author: {id: 3, firstName: 'Bartholomew', lastName: 'Simpson'},
      });

      const q = r.getQuery(Author, {x: 1})!;
      const a = q.models.find(m => m?.id === 3);

      expect(a instanceof Author).toBe(true);
      expect(a!.attributes.firstName).toBe('Bartholomew');
      expect(a!.attributes.lastName).toBe('Simpson');
    });
  });
});

describe('Repo#loadQuery', () => {
  it('loads the models and assigns them to a Query object', () => {
    const r = new Repo().loadQuery(Author, {}, [
      {id: 1, firstName: 'Homer', lastName: 'Simpson'},
      {id: 2, firstName: 'Marge', lastName: 'Simpson'},
      {id: 3, firstName: 'Bart', lastName: 'Simpson'},
    ]);

    const as = r.getQuery(Author, {});

    expect(as instanceof Query).toBe(true);
    expect(as!.models.length).toBe(3);
    expect(as!.models[0] instanceof Author).toBe(true);
    expect(as!.models[0]!.id).toBe(1);
    expect(as!.models[0]!.attributes.firstName).toBe('Homer');
    expect(as!.models[1] instanceof Author).toBe(true);
    expect(as!.models[1]!.id).toBe(2);
    expect(as!.models[1]!.attributes.firstName).toBe('Marge');
    expect(as!.models[2] instanceof Author).toBe(true);
    expect(as!.models[2]!.id).toBe(3);
    expect(as!.models[2]!.attributes.firstName).toBe('Bart');
  });

  describe('with paging parameters', () => {
    it('creates a sparse array', () => {
      let r = new Repo().loadQuery(
        Author,
        {},
        [
          {id: 1, firstName: 'Homer', lastName: 'Simpson'},
          {id: 2, firstName: 'Marge', lastName: 'Simpson'},
          {id: 3, firstName: 'Bart', lastName: 'Simpson'},
        ],
        {page: 0, pageSize: 3, count: 10},
      );

      let as = r.getQuery(Author, {});
      expect(as instanceof Query).toBe(true);
      expect(as!.models.length).toBe(10);
      expect(as!.models[0] instanceof Author).toBe(true);
      expect(as!.models[0]!.id).toBe(1);
      expect(as!.models[0]!.attributes.firstName).toBe('Homer');
      expect(as!.models[1] instanceof Author).toBe(true);
      expect(as!.models[1]!.id).toBe(2);
      expect(as!.models[1]!.attributes.firstName).toBe('Marge');
      expect(as!.models[2] instanceof Author).toBe(true);
      expect(as!.models[2]!.id).toBe(3);
      expect(as!.models[2]!.attributes.firstName).toBe('Bart');
      for (let i = 3; i <= 9; i++) {
        expect(as!.models[i]).toBeUndefined();
      }

      r = r.loadQuery(
        Author,
        {},
        [
          {id: 7, firstName: 'Ned', lastName: 'Flanders'},
          {id: 8, firstName: 'Maude', lastName: 'Flanders'},
          {id: 9, firstName: 'Chief', lastName: 'Wiggum'},
        ],
        {page: 2, pageSize: 3, count: 10},
      );

      as = r.getQuery(Author, {});
      expect(as instanceof Query).toBe(true);
      expect(as!.models.length).toBe(10);
      expect(as!.models[0] instanceof Author).toBe(true);
      expect(as!.models[0]!.id).toBe(1);
      expect(as!.models[0]!.attributes.firstName).toBe('Homer');
      expect(as!.models[1] instanceof Author).toBe(true);
      expect(as!.models[1]!.id).toBe(2);
      expect(as!.models[1]!.attributes.firstName).toBe('Marge');
      expect(as!.models[2] instanceof Author).toBe(true);
      expect(as!.models[2]!.id).toBe(3);
      expect(as!.models[2]!.attributes.firstName).toBe('Bart');
      expect(as!.models[3]).toBeUndefined();
      expect(as!.models[4]).toBeUndefined();
      expect(as!.models[5]).toBeUndefined();
      expect(as!.models[6] instanceof Author).toBe(true);
      expect(as!.models[6]!.id).toBe(7);
      expect(as!.models[6]!.attributes.firstName).toBe('Ned');
      expect(as!.models[7] instanceof Author).toBe(true);
      expect(as!.models[7]!.id).toBe(8);
      expect(as!.models[7]!.attributes.firstName).toBe('Maude');
      expect(as!.models[8] instanceof Author).toBe(true);
      expect(as!.models[8]!.id).toBe(9);
      expect(as!.models[8]!.attributes.firstName).toBe('Chief');
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
    expect(p!.state).toBe('empty');
    expect(p!.attributes).toEqual({id: 1});

    const result = await a();

    r = r.processMapperResult(result);

    p = r.getModel(Post, 1);
    expect(p instanceof Post).toBe(true);
    expect(p!.id).toBe(1);
    expect(p!.state).toBe('loaded');
    expect(p!.attributes).toEqual({id: 1, title: 'First Post!'});
  });

  describe('when an error occurs', () => {
    it('adds a base error to the model', async () => {
      let r = new Repo();
      let a: MapperAction;

      [r, a] = r.fetch(Post, 99999);

      let p = r.getModel(Post, 99999);

      expect(p instanceof Post).toBe(true);
      expect(p!.id).toBe(99999);
      expect(p!.state).toBe('empty');
      expect(p!.attributes).toEqual({id: 99999});
      expect(p!.errors).toEqual({});

      const result = await a();

      r = r.processMapperResult(result);

      p = r.getModel(Post, 99999);
      expect(p instanceof Post).toBe(true);
      expect(p!.id).toBe(99999);
      expect(p!.state).toBe('empty');
      expect(p!.attributes).toEqual({id: 99999});
      expect(p!.errors).toEqual({base: 'boom'});
    });
  });
});
