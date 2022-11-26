import util from 'util';
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

type PostAttributes = FromSchema<typeof PostAttributesSchema>;

class Post extends Model<PostAttributes> {
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

type AuthorAttributes = FromSchema<typeof AuthorAttributesSchema>;

class Author extends Model<AuthorAttributes> {
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

type CommentAttributes = FromSchema<typeof CommentAttributesSchema>;

class Comment extends Model<CommentAttributes> {
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

let repo = new Repo().load(Post, [
  {
    id: 1,
    title: 'First Post!',
    author: {id: 9, firstName: 'Homer', lastName: 'Simpson'},
    comments: [
      {id: 100, text: 'a'},
      {id: 105, text: 'b'},
      {id: 109, text: 'c'},
    ],
  },
  {
    id: 2,
    title: 'Hello World',
    author: {id: 10, firstName: 'Marge', lastName: 'Simpson'},
    comments: [
      {id: 102, text: 'd'},
      {id: 104, text: 'e'},
      {id: 111, text: 'f'},
    ],
  },
  {
    id: 3,
    title: 'Second Post!',
    author: {id: 9, firstName: 'Homer', lastName: 'Simpson'},
    comments: [],
  },
]);

const p = repo.getModel(Post, 2)!;
console.log(p.author);
console.log(p.author!.posts.includes(p));

// console.log('1:');
// console.log(util.inspect(repo, {depth: null}));

// repo = repo.load(Post, [
//   {
//     id: 1,
//     text: 'First Post!',
//     author: 10,
//   },
// ]);
//
// console.log('2:');
// console.log(util.inspect(repo, {depth: 4}));

// repo = repo.load(Post, [
//   {
//     id: 1,
//     title: 'First Post!',
//     author: {id: 9, firstName: 'Homer', lastName: 'Simpson'},
//     comments: [
//       {id: 100, text: 'a'},
//       {id: 105, text: 'b'},
//     ],
//   },
// ]);
//
// console.log('2:');
// console.log(util.inspect(repo, {depth: 3}));
