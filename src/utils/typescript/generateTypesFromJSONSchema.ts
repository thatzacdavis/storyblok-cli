import fs from "fs";
import lodash from "lodash";
import { compile, type JSONSchema } from "json-schema-to-typescript";
import type {
  BlokSchemaPropertyTypeAnnotation,
  ISbBlokPropertySchema,
  ISbBlokSchemaAutogeneratedPropertyType,
  JSONSchemaToTSOptions,
} from "../../types";
import {
  getAssetJSONSchema,
  getMultiassetJSONSchema,
  getMultilinkJSONSchema,
  getRichtextJSONSchema,
  getTableJSONSchema,
} from "./autogeneratedStoryblokTypes";

const { camelCase, startCase } = lodash;

type GenerateTSTypedefsFromComponentsJSONSchemasOptions = {
  sourceFilePaths: string[];
  destinationFilePath: string;
  typeNamesPrefix?: string;
  typeNamesSuffix?: string;
  customFieldTypesParserPath?: string;
  JSONSchemaToTSCustomOptions: JSONSchemaToTSOptions;
};

type CustomTypeParser = (_typeName: string, _schema: JSONSchema) => Record<string, any>;

type GetAutogeneratedTypeSchemaFn = (title: string) => JSONSchema;

type ComponentGroupsAndNamesObject = {
  componentGroups: Map<string, Set<string>>;
  componentNames: Set<string>;
};

export class GenerateTypesFromJSONSchemas {
  #STORY_DATATYPE_NAME = "ISbStoryData";

  #options: GenerateTSTypedefsFromComponentsJSONSchemasOptions;
  #componentsJSONSchemas: JSONSchema[];
  #customTypeParser: CustomTypeParser | null;
  #typeDefsFileStrings: string[] = [`import type { ${this.#STORY_DATATYPE_NAME} } from "storyblok";`];
  #componentGroups: Map<string, Set<string>>;
  #componentNames: Set<string>;

  #getAutogeneratedTypeSchema = new Map<ISbBlokSchemaAutogeneratedPropertyType, GetAutogeneratedTypeSchemaFn>([
    ["asset", getAssetJSONSchema],
    ["multiasset", getMultiassetJSONSchema],
    ["multilink", getMultilinkJSONSchema],
    ["richtext", getRichtextJSONSchema],
    ["table", getTableJSONSchema],
  ]);

  #hasTypeBeenGenerated = new Map<ISbBlokSchemaAutogeneratedPropertyType, boolean>([
    ["asset", false],
    ["multiasset", false],
    ["multilink", false],
    ["richtext", false],
    ["table", false],
  ]);

  private constructor(
    componentsJSONSchemas: JSONSchema[],
    options: GenerateTSTypedefsFromComponentsJSONSchemasOptions,
    customTypeParser: CustomTypeParser | null
  ) {
    this.#options = options;
    this.#componentsJSONSchemas = componentsJSONSchemas;
    this.#customTypeParser = customTypeParser;
    const { componentGroups, componentNames } =
      this.#generateComponentGroupsAndComponentNamesFromJSONSchemas(componentsJSONSchemas);
    this.#componentGroups = componentGroups;
    this.#componentNames = componentNames;
  }

  /**
   * This method act as a proxy to have an async constructor. It initializes the class instance and loads a parser for custom field types
   * @param componentsJSONSchemas An array of Storyblok components schemas
   * @param options A set of options for the command
   * @returns An instance of the GenerateTypesFromJSONSchemas class
   */
  static async init(componentsJSONSchemas: JSONSchema[], options: GenerateTSTypedefsFromComponentsJSONSchemasOptions) {
    const customTypeParser = await this.#loadCustomFieldTypeParser(options.customFieldTypesParserPath);

    return new GenerateTypesFromJSONSchemas(componentsJSONSchemas, options, customTypeParser);
  }

  /**
   * Loads a parser for custom field types.
   * A `parser` in this case means a function that is the default export of a JS module (can be both CommonJS or ESM) that given a JSONSchema custom property returns a predefined JSONSchema for that property, so that it can be later converted into the appropriate Typedef
   * @param path Path to the file that exports the parser function
   * @returns The parser function or null
   */
  static async #loadCustomFieldTypeParser(path?: string): Promise<CustomTypeParser | null> {
    if (path) {
      try {
        const customTypeParser = await import(path);
        return customTypeParser.default;
      } catch (e) {
        // TODO: log error
        return null;
      }
    }

    return null;
  }

  /**
   * Extract all component names and all the groups containing the respective components from an array of component JSONSchemas.
   * @param componentsJSONSchemas Array of Storyblok component schemas
   * @returns An object with two properties, `componentGroups` that holds the relationship between groups and child components and `componentNames` which is a list of all the component names, including the ones that do not belong to any group.
   */
  #generateComponentGroupsAndComponentNamesFromJSONSchemas(componentsJSONSchemas: JSONSchema[]) {
    const { componentGroups, componentNames } = componentsJSONSchemas.reduce<ComponentGroupsAndNamesObject>(
      (acc, currentComponent) => {
        if (currentComponent.component_group_uuid)
          acc.componentGroups.set(
            currentComponent.component_group_uuid,
            acc.componentGroups.has(currentComponent.component_group_uuid)
              ? acc.componentGroups.get(currentComponent.component_group_uuid)!.add(currentComponent.name)
              : new Set([currentComponent.name])
          );

        acc.componentNames.add(currentComponent.name);
        return acc;
      },
      { componentGroups: new Map(), componentNames: new Set() }
    );

    return { componentGroups, componentNames };
  }

  /**
   * Triggers the whole TS Type definition process
   * @returns The class instance
   */
  async generateTSFile() {
    for await (const component of this.#componentsJSONSchemas) {
      // By default all types will havea a required `_uid` and a required `component` properties
      const requiredFields = Object.entries<Record<string, any>>(component.schema).reduce(
        (acc, [key, value]) => {
          if (value.required) {
            return [...acc, key];
          }
          return acc;
        },
        ["component", "_uid"]
      );

      const title = this.#getBlokTypeName(component.name);
      const obj: JSONSchema = {
        $id: `#/${component.name}`,
        title,
        type: "object",
        required: requiredFields,
      };

      obj.properties = await this.#typeMapper(component.schema);
      obj.properties._uid = {
        type: "string",
      };
      obj.properties.component = {
        type: "string",
        enum: [component.name],
      };

      try {
        const ts = await compile(obj, component.name, this.#options.JSONSchemaToTSCustomOptions);
        this.#typeDefsFileStrings.push(ts);
      } catch (e) {
        console.log("ERROR", e);
      }
    }

    return this.#writeTypeDefs();
  }

  async #typeMapper(componentSchema: JSONSchema) {
    const parseObj = {};

    for await (const [schemaKey, schemaElement] of Object.entries(componentSchema)) {
      // Schema keys that start with `tab-` are only used for describing tabs in the Storyblok UI.
      // Therefore they are ignored.
      if (schemaKey.startsWith("tab-")) {
        continue;
      }

      const obj: JSONSchema = {};
      const type = schemaElement.type;
      const element = this.#parseBlokSchemaProperty(schemaElement);
      obj[schemaKey] = element;

      // Generate type for custom field
      if (type === "custom") {
        Object.assign(
          parseObj,
          typeof this.#customTypeParser === "function" ? this.#customTypeParser(schemaKey, schemaElement) : {}
        );

        continue;
      }

      // Generate type for field types provided by Storyblok

      // Include Storyblok field type type definition, if needed
      if (this.#autogeneratedPropertyTypes.includes(type)) {
        const blokName = this.#getBlokTypeName(type);
        const ts = await this.#generateType(type, blokName);
        obj[schemaKey].tsType = blokName;

        if (ts) {
          this.#typeDefsFileStrings.push(ts);
        }
      }

      if (type === "multilink") {
        const excludedLinktypes = [];
        const baseType = this.#getBlokTypeName(type);

        // TODO: both email_link_type and asset_link_type are booleans that could also be undefined.
        // Do we want to exclude link types also in those cases?
        if (!schemaElement.email_link_type) {
          excludedLinktypes.push('{ linktype?: "email" }');
        }
        if (!schemaElement.asset_link_type) {
          excludedLinktypes.push('{ linktype?: "asset" }');
        }

        obj[schemaKey].tsType =
          excludedLinktypes.length > 0 ? `Exclude<${baseType}, ${excludedLinktypes.join(" | ")}>` : baseType;
      }

      if (type === "bloks") {
        if (schemaElement.restrict_components) {
          // Bloks restricted by groups
          if (schemaElement.restrict_type === "groups") {
            if (
              Array.isArray(schemaElement.component_group_whitelist) &&
              schemaElement.component_group_whitelist.length > 0
            ) {
              const currentGroupElements = schemaElement.component_group_whitelist.reduce(
                (bloks: string[], groupUUID: string) => {
                  const bloksInGroup = this.#componentGroups.get(groupUUID);
                  return bloksInGroup
                    ? [...bloks, ...Array.from(bloksInGroup).map((blokName) => this.#getBlokTypeName(blokName))]
                    : bloks;
                },
                []
              );

              obj[schemaKey].tsType =
                currentGroupElements.length > 0 ? `(${currentGroupElements.join(" | ")})[]` : `never[]`;
            }
          } else {
            // Bloks restricted by 1-by-1 list
            if (Array.isArray(schemaElement.component_whitelist) && schemaElement.component_whitelist.length > 0) {
              obj[schemaKey].tsType = `(${schemaElement.component_whitelist
                .map((name: string) => this.#getBlokTypeName(name))
                .join(" | ")})[]`;
            }
          }
        } else {
          // All bloks can be slotted in this property (AKA no restrictions)
          obj[schemaKey].tsType = `(${Array.from(this.#componentNames)
            .map((blokName) => this.#getBlokTypeName(blokName))
            .join(" | ")})[]`;
        }
      }

      Object.assign(parseObj, obj);
    }

    return parseObj;
  }

  /**
   * Get the correct JSONSchema type annotation for the provided Blok schema property object
   * @param schemaProperty A Storyblok Blok `schema` property object, A.K.A. what you can find in a key of the `schema` property inside a components JSONSchema.
   * @returns A BlokSchemaPropertyTypeAnnotation object
   */
  #parseBlokSchemaProperty(schemaProperty: ISbBlokPropertySchema): BlokSchemaPropertyTypeAnnotation {
    // If a property type is one of the autogenerated ones, return that type
    // Casting as string[] to avoid TS error on using Array.includes on different narrowed types
    if ((this.#autogeneratedPropertyTypes as string[]).includes(schemaProperty.type)) {
      return {
        type: schemaProperty.type,
      };
    }

    // Initialize property type as any (fallback type)
    let type: string | string[] = "any";

    // Initialize the array of options (possible values) of the property
    const options =
      schemaProperty.options && schemaProperty.options.length > 0
        ? schemaProperty.options.map((item) => item.value)
        : [];

    // Add empty option to options array
    if (options.length > 0 && schemaProperty.exclude_empty_option !== true) {
      options.unshift("");
    }

    if (schemaProperty.source === "internal_stories") {
      if (schemaProperty.filter_content_type) {
        return {
          tsType: `(${schemaProperty.filter_content_type
            .map((type2) => this.#getStoryType(type2))
            // In this case schemaProperty.type can be `option` or `options`. In case of `options` the type should be an array
            .join(" | ")} | string )${schemaProperty.type === "options" ? "[]" : ""}`,
        };
      }
    }

    if (
      // If there is no `source` and there are options, the data source is the blok itself
      // TODO: check if this is an old behaviour (shouldn't this be handled as an "internal" source?)
      (options.length > 0 && !schemaProperty.source) ||
      schemaProperty.source === "internal_languages" ||
      schemaProperty.source === "external"
    ) {
      type = "string";
    }

    if (schemaProperty.source === "internal") {
      type = ["number", "string"];
    }

    if (schemaProperty.type === "option") {
      if (options.length > 0) {
        return {
          type,
          enum: options,
        };
      }

      return {
        type,
      };
    }

    if (schemaProperty.type === "options") {
      if (options.length > 0) {
        return {
          type: "array",
          items: {
            enum: options,
          },
        };
      }

      return {
        type: "array",
        items: { type },
      };
    }

    switch (schemaProperty.type) {
      case "bloks":
        return { type: "array" };
      case "boolean":
        return { type: "boolean" };
      case "datetime":
      case "image":
      case "markdown":
      case "number":
      case "text":
      case "textarea":
        return { type: "string" };
      default:
        return { type: "any" };
    }
  }

  /**
   * Generate the Type name from the supplied blok name with the provided options
   * @param blokName The name of the blok (in snake_case)
   * @returns A string with the Type name in PascalCase, as for Typescript standards
   */
  #getBlokTypeName(blokName: string) {
    return startCase(
      camelCase(`${this.#options.typeNamesPrefix ?? ""}${blokName}${this.#options.typeNamesSuffix}`)
    ).replace(/ /g, "");
  }

  /**
   * Get the Typescript Type of a content-type wrapped in the Type defined for the whole story object, which is stored in this.#STORY_DATATYPE_NAME
   * @param storyBlokName The name of the content-type
   * @returns The Typescript Type for the corresponding content-type
   */
  #getStoryType(storyBlokName: string) {
    return `${this.#STORY_DATATYPE_NAME}<${this.#getBlokTypeName(storyBlokName)}>`;
  }

  /**
   * Generate one of the default types that are provided by Storyblok - such as Multilink, Asset, etc. - that can be autogenerated, if they have not been already generated
   * @param typeName One of the default property types that can be autogenerated
   * @param title The name of the property
   * @returns The type definition for the provided property
   */
  async #generateType(typeName: ISbBlokSchemaAutogeneratedPropertyType, title: string) {
    return !this.#hasTypeBeenGenerated.get(typeName) && (await this.#generateAutogeneratedType(typeName, title));
  }

  /**
   *
   * @param typeName
   * @param title
   * @returns
   */
  async #generateAutogeneratedType(typeName: ISbBlokSchemaAutogeneratedPropertyType, title: string) {
    try {
      const schema = this.#getAutogeneratedTypeSchema.get(typeName)?.(title);
      return schema && (await this.#generateTypeString(schema, typeName));
    } catch (e) {
      console.error(`Error generating type ${typeName} with title ${title}`, e);
    }
  }

  /**
   * Leverage json-schema-to-typescript to compile a component schema whose type is one of the default types provided by Storyblok into a Typescript Type string
   * @param schema The JSON Schema of a component
   * @param typeName One of the default property types provided by Storyblok
   * @returns A string containing the Typescript Type definition of the provided component
   */
  async #generateTypeString(schema: JSONSchema, typeName: ISbBlokSchemaAutogeneratedPropertyType) {
    // TODO: handle potential errors and log error messages
    const typeString = await compile(schema, typeName, this.#options.JSONSchemaToTSCustomOptions);
    this.#hasTypeBeenGenerated.set(typeName, true);

    return typeString;
  }

  /**
   * Write the array of type definitions - one entry per type - to the file at the provided `destinationFilePath`
   * @returns The class instance
   */
  #writeTypeDefs() {
    if (this.#options.destinationFilePath) {
      fs.writeFileSync(this.#options.destinationFilePath, this.#typeDefsFileStrings.join("\n"));
    }

    return this;
    // TODO: log error in case of missing path
  }

  /**
   * Get the list of Storyblok default property types that will be autogenerated, if any component property has been set as one of them
   */
  get #autogeneratedPropertyTypes() {
    return Array.from(this.#getAutogeneratedTypeSchema.keys());
  }
}
