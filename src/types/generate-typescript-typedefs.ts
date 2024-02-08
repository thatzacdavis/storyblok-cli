import type { Options } from "json-schema-to-typescript";
export type {
  ISbConfig, // previously StoryblokConfig
  ISbCache, // previously StoryblokCache
  ISbResult, // previously StoryblokResult
  ISbResponse,
  ISbError,
  ISbNode,
  ISbSchema,
  ThrottleFn,
  AsyncFn,
  ArrayFn,
  ISbContentMangmntAPI,
  ISbManagmentApiResult, // previously StoryblokManagmentApiResult
  ISbStories, // previously Stories
  ISbStory, // previously Story
  ISbDimensions,
  ISbStoryData, // previously StoryData
  ISbAlternateObject, // previously AlternateObject
  ISbStoriesParams, // previously StoriesParams
  ISbStoryParams, // previously StoryParams
  ISbRichtext, // previously Richtext
} from "storyblok-js-client";

export type ISbBlokSchemaAutogeneratedPropertyType = "asset" | "multiasset" | "multilink" | "table" | "richtext";

export type ISbBlokPropertySchemaType =
  | ISbBlokSchemaAutogeneratedPropertyType
  | "array"
  | "bloks"
  | "boolean"
  | "datetime"
  | "image"
  | "markdown"
  | "number"
  | "option"
  | "options"
  | "text"
  | "textarea";

export type JSONSchemaToTSOptions = Partial<Options>;

export interface GenerateTypescriptTypedefsCLIOptions {
  sourceFilePaths: string[];
  destinationFilePath?: string;
  typeNamesPrefix?: string;
  typeNamesSuffix?: string;
  customFieldTypesParserPath?: string;
  JSONSchemaToTSOptionsPath?: string;
}

export interface ISbBlokPropertySchemaOption {
  _uid: string;
  name: string;
  value: string;
}

export type ISbBlokPropertySchema = {
  type: ISbBlokPropertySchemaType;
  pos: number;
  key: string;
  use_uuid?: boolean;
  source?: "internal" | "external" | "internal_stories" | "internal_languages";
  options?: ISbBlokPropertySchemaOption[];
  filter_content_type?: string[];
  restrict_components?: boolean;
  component_whitelist?: string[];
  component_group_whitelist?: string[];
  restrict_type?: "groups" | "";
  exclude_empty_option?: boolean;
};

export type BlokSchemaPropertyTypeAnnotation =
  | {
      tsType: string | string[];
    }
  | {
      type: string | string[];
      enum: string[];
    }
  | {
      type: string | string[];
    }
  | {
      type: "array";
      items: {
        type: string | string[];
      };
    }
  | {
      type: "array";
      items: {
        enum: string[];
      };
    };
