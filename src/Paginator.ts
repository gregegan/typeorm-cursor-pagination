import {
  Brackets,
  ObjectType,
  OrderByCondition,
  SelectQueryBuilder,
  WhereExpression,
} from 'typeorm';

import {
  atob,
  btoa,
  encodeByType,
  decodeByType,
  pascalToUnderscore,
} from './utils';

export type Order = 'ASC' | 'DESC';

interface CursorParam {
  [key: string]: any;
}

export interface Cursor {
  beforeCursor: string | null;
  afterCursor: string | null;
}

export default class Paginator<Entity> {
  private afterCursor: string | null = null;

  private beforeCursor: string | null = null;

  private nextAfterCursor: string | null = null;

  private nextBeforeCursor: string | null = null;

  private alias: string = pascalToUnderscore(this.entity.name);

  private limit = 10;

  private order: Order = 'DESC';

  public constructor(
    private entity: ObjectType<Entity>,
    private paginationKeys: Extract<keyof Entity, string>[],
  ) { }

  public setAlias(alias: string): void {
    this.alias = alias;
  }

  public setAfterCursor(cursor: string): void {
    this.afterCursor = cursor;
  }

  public setBeforeCursor(cursor: string): void {
    this.beforeCursor = cursor;
  }

  public setLimit(limit: number): void {
    this.limit = limit;
  }

  public setOrder(order: Order): void {
    this.order = order;
  }

  public getCursor(): Cursor {
    return {
      afterCursor: this.nextAfterCursor,
      beforeCursor: this.nextBeforeCursor,
    };
  }

  public async paginate(builder: SelectQueryBuilder<Entity>): Promise<Entity[]> {
    const entities = await this.appendPagingQuery(builder).getMany();
    const hasMore = entities.length > this.limit;

    if (hasMore) {
      entities.splice(entities.length - 1, 1);
    }

    if (entities.length === 0) {
      return entities;
    }

    if (!this.hasAfterCursor() && this.hasBeforeCursor()) {
      entities.reverse();
    }

    if (this.hasBeforeCursor() || hasMore) {
      this.nextAfterCursor = this.encode(entities[entities.length - 1]);
    }

    if (this.hasAfterCursor() || (hasMore && this.hasBeforeCursor())) {
      this.nextBeforeCursor = this.encode(entities[0]);
    }

    return entities;
  }

  private appendPagingQuery(builder: SelectQueryBuilder<Entity>): SelectQueryBuilder<Entity> {
    const cursors: CursorParam = {};

    if (this.hasAfterCursor()) {
      Object.assign(cursors, this.decode(this.afterCursor as string));
    } else if (this.hasBeforeCursor()) {
      Object.assign(cursors, this.decode(this.beforeCursor as string));
    }

    if (Object.keys(cursors).length > 0) {
      builder.andWhere(new Brackets((where) => this.buildCursor(where, cursors)));
    }

    builder.take(this.limit + 1);
    builder.orderBy(this.buildOrder());

    return builder;
  }

  private buildCursor(where: WhereExpression, cursors: CursorParam): void {
    const operator = this.getOperator();
    const params: CursorParam = {};
    let query = '';
    this.paginationKeys.forEach((key) => {
      params[key] = cursors[key];
      where.orWhere(`${query}${this.alias}.${key} ${operator} :${key}`, params);
      query = `${query}${this.alias}.${key} = :${key} AND `;
    });
  }

  private getOperator(): string {
    if (this.hasAfterCursor()) {
      return this.order === 'ASC' ? '>' : '<';
    }

    if (this.hasBeforeCursor()) {
      return this.order === 'ASC' ? '<' : '>';
    }

    return '=';
  }

  private buildOrder(): OrderByCondition {
    let { order } = this;

    if (!this.hasAfterCursor() && this.hasBeforeCursor()) {
      order = this.flipOrder(order);
    }

    const orderByCondition: OrderByCondition = {};
    this.paginationKeys.forEach((key) => {
      orderByCondition[`${this.alias}.${key}`] = order;
    });

    return orderByCondition;
  }

  private hasAfterCursor(): boolean {
    return this.afterCursor !== null;
  }

  private hasBeforeCursor(): boolean {
    return this.beforeCursor !== null;
  }

  private encode(entity: Entity): string {
    const payload = this.paginationKeys.map((key) => {
      const type = this.getEntityPropertyType(key);
      const value = encodeByType(type, entity[key]);
      return `${key}:${value}`;
    }).join(',');

    return btoa(payload);
  }

  private decode(cursor: string): CursorParam {
    const cursors: CursorParam = {};
    const columns = atob(cursor).split(',');
    columns.forEach((column) => {
      const [key, raw] = column.split(':');
      const type = this.getEntityPropertyType(key);
      const value = decodeByType(type, raw);
      cursors[key] = value;
    });

    return cursors;
  }

  private getEntityPropertyType(key: string): string {
    return Reflect.getOwnMetadata('design:type', this.entity.prototype, key).name.toLowerCase();
  }

  private flipOrder(order: Order): Order {
    return order === 'ASC'
      ? 'DESC'
      : 'ASC';
  }
}