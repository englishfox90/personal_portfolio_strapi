import type { Schema, Struct } from '@strapi/strapi';

export interface NinaDataSyncAcquisitionObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_acquisition_objects';
  info: {
    displayName: 'Acquisition Object';
  };
  attributes: {
    activeFilter: Schema.Attribute.String;
    exposureSeconds: Schema.Attribute.Integer;
    gain: Schema.Attribute.Integer;
    startedAt: Schema.Attribute.DateTime;
    temperature: Schema.Attribute.Decimal;
    timestamp: Schema.Attribute.DateTime;
  };
}

export interface NinaDataSyncActivityLogItemObject
  extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_activity_log_item_objects';
  info: {
    displayName: 'Activity Log Item Object';
  };
  attributes: {
    level: Schema.Attribute.Enumeration<['info', 'warning', 'error']>;
    message: Schema.Attribute.String;
    timestamp: Schema.Attribute.DateTime;
  };
}

export interface NinaDataSyncDeviceStatusObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_device_status_objects';
  info: {
    displayName: 'Device Status Object';
  };
  attributes: {
    connected: Schema.Attribute.Boolean;
    name: Schema.Attribute.String;
  };
}

export interface NinaDataSyncEnvironmentObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_environment_objects';
  info: {
    displayName: 'Environment Object';
  };
  attributes: {
    weather: Schema.Attribute.Component<'nina-data-sync.weather-object', false>;
  };
}

export interface NinaDataSyncEquipmentObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_equipment_objects';
  info: {
    displayName: 'Equipment Object';
  };
  attributes: {
    camera: Schema.Attribute.Component<
      'nina-data-sync.device-status-object',
      false
    >;
    dome: Schema.Attribute.Component<
      'nina-data-sync.device-status-object',
      false
    >;
    filterWheel: Schema.Attribute.Component<
      'nina-data-sync.device-status-object',
      false
    >;
    flatDevice: Schema.Attribute.Component<
      'nina-data-sync.device-status-object',
      false
    >;
    focuser: Schema.Attribute.Component<
      'nina-data-sync.device-status-object',
      false
    >;
    guider: Schema.Attribute.Component<
      'nina-data-sync.device-status-object',
      false
    >;
    mount: Schema.Attribute.Component<
      'nina-data-sync.device-status-object',
      false
    >;
    rotator: Schema.Attribute.Component<
      'nina-data-sync.device-status-object',
      false
    >;
    safetyMonitor: Schema.Attribute.Component<
      'nina-data-sync.device-status-object',
      false
    >;
    switch: Schema.Attribute.Component<
      'nina-data-sync.device-status-object',
      false
    >;
    weather: Schema.Attribute.Component<
      'nina-data-sync.device-status-object',
      false
    >;
  };
}

export interface NinaDataSyncImageObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_image_objects';
  info: {
    displayName: 'Image Object';
  };
  attributes: {
    image: Schema.Attribute.Media<'images' | 'files'>;
    metaData: Schema.Attribute.JSON;
  };
}

export interface NinaDataSyncMetaObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_meta_objects';
  info: {
    displayName: 'Meta Object';
  };
  attributes: {
    lastUpdated: Schema.Attribute.DateTime;
    ninaConnected: Schema.Attribute.Boolean;
  };
}

export interface NinaDataSyncPreviewObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_preview_objects';
  info: {
    displayName: 'Preview Object';
  };
  attributes: {
    single: Schema.Attribute.Component<'nina-data-sync.single-object', false>;
    stack: Schema.Attribute.Component<'nina-data-sync.stack-object', false>;
    type: Schema.Attribute.String;
  };
}

export interface NinaDataSyncProjectObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_project_objects';
  info: {
    displayName: 'Project Object';
  };
  attributes: {
    name: Schema.Attribute.String;
    phase: Schema.Attribute.Enumeration<['acquiring', 'paused', 'idle']>;
    targetEndTime: Schema.Attribute.DateTime;
  };
}

export interface NinaDataSyncSingleObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_single_objects';
  info: {
    displayName: 'Single Object';
  };
  attributes: {
    capturedAt: Schema.Attribute.DateTime;
    exposureSeconds: Schema.Attribute.Integer;
    filename: Schema.Attribute.String;
    filter: Schema.Attribute.String;
    stats: Schema.Attribute.Component<'nina-data-sync.stats-object', false>;
  };
}

export interface NinaDataSyncStackObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_stack_objects';
  info: {
    displayName: 'Stack Object';
  };
  attributes: {
    filter: Schema.Attribute.String;
    frameCount: Schema.Attribute.Integer;
    target: Schema.Attribute.String;
    updatedAtTime: Schema.Attribute.DateTime;
  };
}

export interface NinaDataSyncStatsObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_stats_objects';
  info: {
    displayName: 'Stats Object';
  };
  attributes: {
    hfr: Schema.Attribute.Decimal;
    hfrStDev: Schema.Attribute.Decimal;
    max: Schema.Attribute.Decimal;
    mean: Schema.Attribute.Decimal;
    median: Schema.Attribute.Decimal;
    min: Schema.Attribute.Decimal;
    stars: Schema.Attribute.Decimal;
    stdDev: Schema.Attribute.Decimal;
  };
}

export interface NinaDataSyncTargetObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_target_objects';
  info: {
    displayName: 'Target Object';
  };
  attributes: {
    dec: Schema.Attribute.String;
    name: Schema.Attribute.String;
    ra: Schema.Attribute.String;
  };
}

export interface NinaDataSyncWeatherObject extends Struct.ComponentSchema {
  collectionName: 'components_nina_data_sync_weather_objects';
  info: {
    displayName: 'Weather Object';
  };
  attributes: {
    averagePeriod: Schema.Attribute.Decimal;
    cloudCover: Schema.Attribute.Decimal;
    connected: Schema.Attribute.Boolean;
    dewPoint: Schema.Attribute.Decimal;
    humidity: Schema.Attribute.Decimal;
    name: Schema.Attribute.String;
    pressure: Schema.Attribute.Decimal;
    rainRate: Schema.Attribute.Decimal;
    skyBrightness: Schema.Attribute.Decimal;
    skyQuality: Schema.Attribute.Decimal;
    skyTemperature: Schema.Attribute.Decimal;
    starFWHM: Schema.Attribute.Decimal;
    temperature: Schema.Attribute.Decimal;
    timestamp: Schema.Attribute.DateTime;
    windDirection: Schema.Attribute.Decimal;
    windGust: Schema.Attribute.Decimal;
    windSpeed: Schema.Attribute.Decimal;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'nina-data-sync.acquisition-object': NinaDataSyncAcquisitionObject;
      'nina-data-sync.activity-log-item-object': NinaDataSyncActivityLogItemObject;
      'nina-data-sync.device-status-object': NinaDataSyncDeviceStatusObject;
      'nina-data-sync.environment-object': NinaDataSyncEnvironmentObject;
      'nina-data-sync.equipment-object': NinaDataSyncEquipmentObject;
      'nina-data-sync.image-object': NinaDataSyncImageObject;
      'nina-data-sync.meta-object': NinaDataSyncMetaObject;
      'nina-data-sync.preview-object': NinaDataSyncPreviewObject;
      'nina-data-sync.project-object': NinaDataSyncProjectObject;
      'nina-data-sync.single-object': NinaDataSyncSingleObject;
      'nina-data-sync.stack-object': NinaDataSyncStackObject;
      'nina-data-sync.stats-object': NinaDataSyncStatsObject;
      'nina-data-sync.target-object': NinaDataSyncTargetObject;
      'nina-data-sync.weather-object': NinaDataSyncWeatherObject;
    }
  }
}
