import {FromSchema} from 'json-schema-to-ts';
import Repo from './Repo';
import Model from './Model';

const PostAttributesSchema = {
  type: 'object',
  required: ['id', 'title'],
  additionalProperties: false,
  properties: {
    id: {type: 'integer'},
    title: {type: 'string', minLength: 1},
  },
} as const;

class Post extends Model<FromSchema<typeof PostAttributesSchema>> {
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
});
